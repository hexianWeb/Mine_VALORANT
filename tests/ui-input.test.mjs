import assert from 'node:assert/strict'
import test from 'node:test'
import { createUiInput } from '../src/app/ui-input.js'
import { inputBindings } from '../src/configs/input-bindings.js'
import { EventEmitter } from '../src/engine/runtime/core/events.js'
import { Engine } from '../src/engine/runtime/engine.js'
import { setupInput } from './input-fixture.mjs'

function setup(t, { pointerLock = true } = {}) {
  const f = setupInput({ bindings: inputBindings, pointerLock })
  const ui = {
    events: new EventEmitter(),
    stack: [],
    get topModal() { return this.stack.at(-1) ?? null },
    open(id) {
      this.stack.push(id)
      this.events.emit('modal', { kind: 'open', reason: 'action' })
    },
    closeTop(reason = 'action') {
      this.stack.pop()
      this.events.emit('modal', { kind: 'close', reason })
    },
    closeAll(reason) { while (this.topModal) this.closeTop(reason) },
  }
  const player = {
    enabled: true,
    blocked: false,
    paused: false,
    setInputBlocked(value) { this.blocked = value },
    setPaused(value) { this.paused = value },
  }
  const engine = new Engine({
    autoPauseOnHidden: false,
    frameDriver: {
      request: () => 1,
      cancel() {},
    },
  })
  f.input.setEnabled(true)
  const controls = createUiInput({
    canvas: f.element,
    input: f.input,
    player,
    engine,
    ui,
    onSettings: () => ui.topModal === 'range-settings'
      ? ui.closeTop()
      : ui.open('range-settings'),
    onShop: () => ui.open('future-shop-fixture'),
  })
  engine.start()
  t.after(() => {
    controls.dispose()
    engine.destroy()
    f.input.dispose()
  })
  return { ...f, ui, player, engine, controls }
}

test('touch gameplay survives modal and background handoffs without requesting pointer lock or replaying a gesture', (t) => {
  const f = setup(t, { pointerLock: false })
  const { input, controls, ui } = f
  assert.equal(controls.read().mode, 'gameplay')
  f.click()
  input.setVirtualButton(1, 'fire', true)
  input.setVirtualAxis('moveZ', 0.65)
  input.addVirtualLook(30, 12)
  ui.open('range-settings')
  assert.equal(input.blocked, true)
  input.setVirtualButton(2, 'jump', true)
  input.addVirtualLook(55, 16)
  ui.closeTop()
  assert.equal(controls.read().mode, 'gameplay')
  assert.equal(input.isDown('fire'), false)
  assert.equal(input.axis('moveZ'), 0)
  assert.deepEqual(input.consumeLook(), [0, 0])
  assert.deepEqual(input.consumePressedEvents(), [])

  f.window.dispatchEvent(new Event('blur'))
  f.window.dispatchEvent(new Event('focus'))
  assert.equal(f.engine.state, 'paused')
  assert.equal(input.blocked, true)
  controls.continue()
  assert.equal(f.engine.state, 'running')
  assert.equal(input.blocked, false)
  assert.equal(input.locked, false)
  assert.equal(f.element.lockOptions, null)
})

test('unlocked canvas focus cannot move/fire; acquiring capture click does not fire', (t) => {
  const f = setup(t)
  f.element.focus()
  f.key('keydown', 'KeyW')
  f.mouse('mousedown')
  assert.equal(f.input.isDown('forward'), false)
  assert.equal(f.player.blocked, true)
  f.click()
  assert.equal(f.controls.read().mode, 'gameplay')
  assert.equal(f.input.consumePressed('fire'), false)
  f.key('keydown', 'KeyW', { repeat: true })
  assert.equal(f.input.isDown('forward'), false, 'old held keys cannot resurrect after capture')
  f.key('keyup', 'KeyW')
  f.key('keydown', 'KeyW')
  assert.equal(f.input.isDown('forward'), true)
})

test('Backquote isolates all input without pausing, disabling player, or replaying held fire', (t) => {
  const f = setup(t)
  f.click()
  f.mouse('mousedown')
  f.mouse('mousedown', 2)
  f.move(12, -7)
  f.key('keydown', 'KeyW')
  f.key('keydown', 'Backquote')
  assert.equal(f.controls.read().mode, 'menu')
  assert.equal(f.engine.state, 'running')
  assert.equal(f.player.enabled, true)
  assert.equal(f.input.enabled, true)
  assert.equal(f.input.locked, false)
  assert.deepEqual(f.input.consumePressedEvents(), [])
  assert.deepEqual(f.input.consumeLook(), [0, 0])
  for (const code of [
    'KeyW',
    'KeyR',
    'KeyT',
    'Home',
    'Digit1',
  ])
    f.key('keydown', code)
  f.mouse('mousedown')
  f.wheel(1)
  assert.deepEqual(f.input.consumePressedEvents(), [])
  f.key('keydown', 'Escape')
  assert.equal(f.ui.topModal, null)
  assert.equal(f.engine.state, 'running', 'first Esc only closes the modal')
  assert.equal(f.input.isDown('fire'), false)
  f.key('keydown', 'Escape', { repeat: true })
  assert.equal(f.engine.state, 'running', 'repeat is not a second Esc')
  f.key('keyup', 'Escape')
  f.key('keydown', 'Escape')
  assert.equal(f.engine.state, 'paused')
  assert.equal(f.input.blocked, true)
})

test('layered modals close only the top and preserve pause reasons', (t) => {
  const f = setup(t)
  f.click()
  f.key('keydown', 'Escape')
  f.key('keyup', 'Escape')
  f.key('keydown', 'Backquote')
  f.ui.open('crosshair')
  f.key('keydown', 'Escape')
  assert.equal(f.ui.topModal, 'range-settings')
  f.key('keydown', 'Escape')
  assert.equal(f.ui.topModal, null)
  assert.equal(f.engine.state, 'paused')
  assert.equal(f.input.locked, false)
  assert.ok(f.controls.read().pauseReasons.includes('escape'))
})

test('B uses the same modal isolation and Esc layering for a future shop adapter', (t) => {
  const f = setup(t)
  f.click()
  f.key('keydown', 'KeyB')
  assert.equal(f.ui.topModal, 'future-shop-fixture')
  assert.equal(f.engine.state, 'running')
  f.key('keydown', 'KeyB', { repeat: true })
  assert.equal(f.ui.stack.length, 1)
  f.key('keydown', 'Escape')
  assert.equal(f.ui.topModal, null)
  assert.equal(f.engine.state, 'running')
})

test('window/background pause freezes time and requires a successful explicit Continue', async (t) => {
  const f = setup(t)
  f.click()
  f.engine.step(0)
  f.engine.step(20)
  const tick = f.engine.time.fixedTick
  f.window.dispatchEvent(new Event('blur'))
  f.document.hidden = true
  f.document.dispatchEvent(new Event('visibilitychange'))
  assert.equal(f.engine.state, 'paused')
  f.document.hidden = false
  f.document.dispatchEvent(new Event('visibilitychange'))
  f.window.dispatchEvent(new Event('focus'))
  assert.equal(f.engine.state, 'paused')
  assert.equal(f.engine.time.fixedTick, tick)
  f.click()
  assert.equal(f.input.locked, false, 'paused canvas clicks cannot bypass Continue')
  f.element.requestPointerLock = () => Promise.reject(new Error('fixture denial'))
  f.controls.continue()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.engine.state, 'paused')
  assert.equal(f.controls.read().waiting, false)
  assert.equal(f.controls.read().captureFailed, true)
  assert.match(f.controls.read().message, /未能捕获鼠标\s+请再次点击「继续」/u)
  f.element.requestPointerLock = () => {
    f.document.pointerLockElement = f.element
    f.document.dispatchEvent(new Event('pointerlockchange'))
    return Promise.resolve()
  }
  f.controls.continue()
  await Promise.resolve()
  assert.equal(f.engine.state, 'running')
  assert.equal(f.controls.read().mode, 'gameplay')
  assert.equal(f.controls.read().captureFailed, false)
  assert.equal(f.input.isDown('fire'), false)
  assert.deepEqual(f.input.consumePressedEvents(), [])
  f.engine.step(10000)
  assert.equal(f.engine.time.fixedTick, tick, 'first resumed frame must not include wall-clock pause')
})

test('late unlock/lock replies cannot override menus, Editor, loss of focus or disposal', (t) => {
  const f = setup(t)
  f.click()
  f.document.exitPointerLock = () => {
    f.document.pointerLockElement = null
  }
  f.key('keydown', 'Backquote')
  f.ui.closeTop()
  assert.equal(f.controls.read().mode, 'unlocked')
  assert.equal(f.input.locked, false)
  f.document.dispatchEvent(new Event('pointerlockchange'))
  assert.equal(f.engine.state, 'running')
  f.player.enabled = false
  f.input.setEnabled(false)
  f.controls.sync()
  f.document.pointerLockElement = f.element
  f.document.dispatchEvent(new Event('pointerlockchange'))
  assert.equal(f.controls.read().mode, 'editor')
  assert.equal(f.input.blocked, true)
  assert.equal(f.input.locked, false)
  f.controls.dispose()
  f.key('keydown', 'Backquote')
  assert.equal(f.ui.topModal, null)
})

test('an external resume cannot silently erase focus/menu pause constraints', (t) => {
  const f = setup(t)
  f.click()
  f.window.dispatchEvent(new Event('blur'))
  f.engine.resume()
  assert.equal(f.engine.state, 'paused')
  assert.equal(f.player.paused, true)
})

test('B remains ordinary text input inside an existing modal', (t) => {
  const f = setup(t)
  f.ui.open('crosshair')
  assert.equal(f.key('keydown', 'KeyB').defaultPrevented, false)
  assert.equal(f.ui.topModal, 'crosshair')
})
