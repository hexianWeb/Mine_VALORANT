import assert from 'node:assert/strict'
import test from 'node:test'
import { inputBindings } from '../src/configs/input-bindings.js'
import { setupInput } from './input-fixture.mjs'

const setup = (options = { bindings: inputBindings }) => setupInput(options)

test('ignores keys while disabled, unfocused or modified by browser shortcuts', (t) => {
  const { input, element, key } = setup()
  t.after(() => input.dispose())
  key('keydown', 'KeyW')
  assert.equal(input.isDown('forward'), false)
  input.setEnabled(true)
  key('keydown', 'KeyW')
  assert.equal(input.isDown('forward'), false, 'canvas not focused')
  element.focus()
  for (const modifier of ['ctrlKey', 'altKey', 'metaKey']) {
    assert.equal(key('keydown', 'KeyW', { [modifier]: true }).defaultPrevented, false)
    assert.equal(input.isDown('forward'), false)
  }
  key('keydown', 'KeyW')
  assert.equal(input.isDown('forward'), true)
  assert.equal(input.consumePressed('forward'), true)
})

test('arbitrary action names expose held state and consume each edge once', (t) => {
  const { input, element, key } = setup({
    bindings: { KeyX: 'interact', KeyZ: 'reload' },
  })
  t.after(() => input.dispose())
  input.setEnabled(true)
  element.focus()
  assert.equal(key('keydown', 'KeyW').defaultPrevented, false)
  assert.equal(key('keydown', 'KeyX').defaultPrevented, true)
  assert.equal(input.isDown('interact'), true)
  assert.equal(input.consumePressed('interact'), true)
  assert.equal(input.consumePressed('interact'), false)
  key('keydown', 'KeyX', { repeat: true })
  assert.equal(input.consumePressed('interact'), false)
  key('keyup', 'KeyX')
  assert.equal(input.isDown('interact'), false)
  assert.equal(input.consumeReleased('interact'), true)
  assert.equal(input.consumeReleased('interact'), false)
  key('keydown', 'KeyZ')
  key('keyup', 'KeyZ')
  assert.equal(input.consumePressed('reload'), true, 'short taps survive until a tick consumes them')
  assert.equal(input.consumeReleased('reload'), true)
  assert.equal(input.intent, undefined, 'movement intent belongs to the game')
})

test('explicit control bindings allow simultaneous actions without reserving default Ctrl shortcuts', (t) => {
  const { input, element, key } = setup({
    bindings: { ControlLeft: 'modifier', KeyW: 'advance' },
  })
  t.after(() => input.dispose())
  input.setEnabled(true)
  element.focus()
  key('keydown', 'ControlLeft', { ctrlKey: true })
  key('keydown', 'KeyW', { ctrlKey: true })
  assert.equal(input.isDown('modifier'), true)
  assert.equal(input.isDown('advance'), true)
  const defaults = setup()
  t.after(() => defaults.input.dispose())
  defaults.input.setEnabled(true)
  defaults.element.focus()
  assert.equal(defaults.key('keydown', 'KeyR', { ctrlKey: true }).defaultPrevented, false)
  assert.equal(defaults.input.consumePressed('respawn'), false)
})

test('has no gameplay key defaults when bindings are omitted', (t) => {
  const { input, element, key } = setup({})
  t.after(() => input.dispose())
  input.setEnabled(true)
  element.focus()
  for (const [code, action] of Object.entries(inputBindings)) {
    assert.equal(key('keydown', code).defaultPrevented, false)
    assert.equal(input.isDown(action), false)
    assert.equal(input.consumePressed(action), false)
  }
})

test('multiple keys produce one action press and release only after the final key', (t) => {
  const { input, element, key } = setup({
    bindings: { KeyA: 'interact', KeyB: 'interact' },
  })
  t.after(() => input.dispose())
  input.setEnabled(true)
  element.focus()
  key('keydown', 'KeyA')
  assert.equal(input.consumePressed('interact'), true)
  key('keydown', 'KeyB')
  assert.equal(input.consumePressed('interact'), false)
  key('keyup', 'KeyA')
  assert.equal(input.isDown('interact'), true)
  assert.equal(input.consumeReleased('interact'), false)
  key('keyup', 'KeyB')
  assert.equal(input.isDown('interact'), false)
  assert.equal(input.consumeReleased('interact'), true)
})

test('mouse look accumulates only while pointer-locked; click requests raw input lock', (t) => {
  const { input, element, move } = setup()
  t.after(() => input.dispose())
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
})

test('unlocking, losing focus and disabling discard held and queued actions', (t) => {
  const { input, element, document, window, key } = setup()
  t.after(() => input.dispose())
  const clearers = [
    () => document.exitPointerLock(),
    () => element.blur(),
    () => window.dispatchEvent(new Event('blur')),
    () => document.dispatchEvent(new Event('visibilitychange')),
    () => input.setEnabled(false),
  ]
  for (const clear of clearers) {
    input.setEnabled(true)
    element.focus()
    key('keydown', 'KeyW')
    key('keydown', 'KeyR')
    key('keyup', 'KeyR')
    assert.equal(input.isDown('forward'), true)
    clear()
    assert.equal(input.isDown('forward'), false)
    assert.equal(input.consumePressed('respawn'), false)
    assert.equal(input.consumeReleased('respawn'), false)
  }
  element.dispatchEvent(new Event('click'))
  input.setEnabled(false)
  assert.equal(document.pointerLockElement, null)
})
