import assert from 'node:assert/strict'
import test from 'node:test'
import { inputBindings } from '../src/configs/input-bindings.js'
import { createInputSystem } from '../src/engine/runtime/function/input/input-system.js'

function setup(options = { bindings: inputBindings }) {
  const window = new EventTarget()
  const document = Object.assign(new EventTarget(), {
    defaultView: window,
    activeElement: null,
    pointerLockElement: null,
    exitPointerLock() {
      this.pointerLockElement = null
      this.dispatchEvent(new Event('pointerlockchange'))
    },
  })
  const element = Object.assign(new EventTarget(), {
    ownerDocument: document,
    lockOptions: null,
    focus() {
      document.activeElement = element
    },
    blur() {
      if (document.activeElement === element)
        document.activeElement = null
    },
    requestPointerLock(options) {
      element.lockOptions = options
      document.pointerLockElement = element
      document.dispatchEvent(new Event('pointerlockchange'))
      return Promise.resolve()
    },
  })
  const key = (type, code, extra = {}) => {
    const event = Object.assign(new Event(type, { cancelable: true }), {
      code,
      repeat: false,
      altKey: false,
      metaKey: false,
      ...extra,
    })
    window.dispatchEvent(event)
    return event
  }
  const move = (x, y) => document.dispatchEvent(Object.assign(new Event('mousemove'), { movementX: x, movementY: y }))
  return {
    window,
    document,
    element,
    key,
    move,
    input: createInputSystem({ element, ...options }),
  }
}

test('ignores keys while disabled or unfocused', () => {
  const { input, element, key } = setup()
  key('keydown', 'KeyW')
  assert.equal(input.intent.moveZ, 0)
  input.setEnabled(true)
  key('keydown', 'KeyW')
  assert.equal(input.intent.moveZ, 0, 'canvas not focused')
  element.focus()
  key('keydown', 'KeyW')
  assert.equal(input.intent.moveZ, 1)
  input.dispose()
})

test('maps WASD, walk and crouch; jump is consumed once and repeats are ignored', () => {
  const { input, element, key } = setup()
  input.setEnabled(true)
  element.focus()
  const event = key('keydown', 'KeyD')
  assert.equal(event.defaultPrevented, true)
  key('keydown', 'KeyS')
  key('keydown', 'ShiftLeft')
  key('keydown', 'KeyC')
  assert.deepEqual({ ...input.intent }, {
    moveX: 1,
    moveZ: -1,
    walk: true,
    crouch: true,
  })
  key('keyup', 'KeyD')
  key('keyup', 'ShiftLeft')
  assert.equal(input.intent.moveX, 0)
  assert.equal(input.intent.walk, false)
  key('keydown', 'Space')
  key('keydown', 'Space', { repeat: true })
  assert.equal(input.consumeJump(), true)
  assert.equal(input.consumeJump(), false)
  input.dispose()
})

test('uses supplied bindings without retaining the game defaults', () => {
  const { input, element, key } = setup({
    bindings: {
      ArrowUp: 'forward',
      ArrowDown: 'back',
      ArrowLeft: 'left',
      ArrowRight: 'right',
      KeyX: 'walk',
      KeyZ: 'crouch',
      Enter: 'jump',
    },
  })
  input.setEnabled(true)
  element.focus()
  for (const code of Object.keys(inputBindings))
    assert.equal(key('keydown', code).defaultPrevented, false)
  assert.deepEqual({ ...input.intent }, {
    moveX: 0,
    moveZ: 0,
    walk: false,
    crouch: false,
  })
  assert.equal(input.consumeJump(), false)

  for (const code of ['ArrowUp', 'ArrowLeft', 'KeyX', 'KeyZ'])
    assert.equal(key('keydown', code).defaultPrevented, true)
  assert.deepEqual({ ...input.intent }, {
    moveX: -1,
    moveZ: 1,
    walk: true,
    crouch: true,
  })
  key('keyup', 'ArrowUp')
  key('keyup', 'ArrowLeft')
  key('keydown', 'ArrowDown')
  key('keydown', 'ArrowRight')
  assert.equal(input.intent.moveX, 1)
  assert.equal(input.intent.moveZ, -1)
  key('keydown', 'Enter')
  assert.equal(input.consumeJump(), true)
  assert.equal(input.consumeJump(), false)
  key('keydown', 'Enter', { repeat: true })
  assert.equal(input.consumeJump(), false)
  input.dispose()
})

test('has no gameplay key defaults when bindings are omitted', () => {
  const { input, element, key } = setup({})
  input.setEnabled(true)
  element.focus()
  for (const code of Object.keys(inputBindings))
    assert.equal(key('keydown', code).defaultPrevented, false)
  assert.deepEqual({ ...input.intent }, {
    moveX: 0,
    moveZ: 0,
    walk: false,
    crouch: false,
  })
  assert.equal(input.consumeJump(), false)
  input.dispose()
})

test('multiple keys can hold the same action independently', () => {
  const { input, element, key } = setup()
  input.setEnabled(true)
  element.focus()
  key('keydown', 'ShiftLeft')
  key('keydown', 'ShiftRight')
  key('keyup', 'ShiftLeft')
  assert.equal(input.intent.walk, true)
  key('keyup', 'ShiftRight')
  assert.equal(input.intent.walk, false)
  input.dispose()
})

test('mouse look accumulates only while pointer-locked; click requests raw input lock', () => {
  const { input, element, move } = setup()
  input.setEnabled(true)
  move(5, 5)
  assert.deepEqual(input.consumeLook(), [0, 0])
  element.dispatchEvent(new Event('click'))
  assert.deepEqual(element.lockOptions, { unadjustedMovement: true })
  assert.equal(input.locked, true)
  move(5, -2)
  move(1, 1)
  assert.deepEqual(input.consumeLook(), [6, -1])
  assert.deepEqual(input.consumeLook(), [0, 0])
  input.dispose()
})

test('unlocking, window blur and disabling clear held input', () => {
  const { input, element, document, window, key } = setup()
  input.setEnabled(true)
  element.dispatchEvent(new Event('click'))
  key('keydown', 'KeyW')
  assert.equal(input.intent.moveZ, 1)
  document.exitPointerLock()
  assert.equal(input.intent.moveZ, 0)
  assert.equal(document.activeElement, null, 'Esc releases keyboard too')
  element.focus()
  key('keydown', 'KeyA')
  window.dispatchEvent(new Event('blur'))
  assert.equal(input.intent.moveX, 0)
  element.dispatchEvent(new Event('click'))
  input.setEnabled(false)
  assert.equal(document.pointerLockElement, null)
  input.dispose()
})
