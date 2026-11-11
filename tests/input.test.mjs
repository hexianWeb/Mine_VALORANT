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
  assert.equal(defaults.input.consumePressed('reload'), false)
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
    key('keydown', 'Home')
    key('keyup', 'Home')
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

test('mouse buttons require pointer lock and the click that acquires lock cannot fire', (t) => {
  const { input, element, mouse, click } = setup()
  t.after(() => input.dispose())
  assert.equal(mouse('mousedown', 0).defaultPrevented, false)
  input.setEnabled(true)
  element.focus()
  assert.equal(mouse('mousedown', 0).defaultPrevented, false)
  assert.equal(input.isDown('fire'), false)
  click()
  assert.equal(input.locked, true)
  assert.equal(input.consumePressed('fire'), false)
  assert.equal(input.consumeReleased('fire'), false)
  assert.equal(input.isDown('fire'), false)
  assert.deepEqual(input.consumePressedEvents(), [])

  assert.equal(mouse('mousedown', 0).defaultPrevented, true)
  assert.equal(input.isDown('fire'), true)
  assert.equal(input.consumePressed('fire'), true)
  mouse('mousedown', 0)
  assert.equal(input.consumePressed('fire'), false, 'duplicate down does not retrigger a held button')
  mouse('mousedown', 2)
  assert.equal(input.isDown('aim'), true)
  mouse('mouseup', 0)
  assert.equal(input.isDown('fire'), false)
  assert.equal(input.consumeReleased('fire'), true)
  assert.equal(input.isDown('aim'), true)
  mouse('mouseup', 2)
  assert.equal(input.consumeReleased('aim'), true)
})

test('asynchronous pointer-lock exit preserves focus handed to the editor but explicit gameplay unlock blurs', (t) => {
  const { input, element, document, click, mouse } = setup()
  t.after(() => input.dispose())
  input.setEnabled(true)
  click()
  mouse('mousedown', 0)
  document.exitPointerLock = () => {
    document.pointerLockElement = null
  }
  input.setEnabled(false)
  element.focus()
  document.dispatchEvent(new Event('pointerlockchange'))
  assert.equal(document.activeElement, element, 'late exit must not revoke the new canvas owner focus')
  assert.equal(input.isDown('fire'), false)
  assert.deepEqual(input.consumePressedEvents(), [])
  input.setEnabled(true)
  click()
  document.exitPointerLock()
  document.dispatchEvent(new Event('pointerlockchange'))
  assert.equal(document.activeElement, null, 'Escape in gameplay still relinquishes focus')
})

test('mouse bindings are generic and suppress the context menu only for a bound locked right button', (t) => {
  const { input, mouse, click, document } = setup({
    bindings: { Mouse1: 'interact', Mouse2: 'zoom' },
  })
  t.after(() => input.dispose())
  assert.equal(mouse('contextmenu', 2).defaultPrevented, false)
  input.setEnabled(true)
  click()
  assert.equal(mouse('mousedown', 0).defaultPrevented, false)
  assert.equal(mouse('mousedown', 1).defaultPrevented, true)
  assert.equal(input.isDown('interact'), true)
  assert.equal(input.consumePressed('interact'), true)
  assert.equal(mouse('contextmenu', 2).defaultPrevented, true)
  document.exitPointerLock()
  assert.equal(mouse('contextmenu', 2).defaultPrevented, false)
  assert.equal(input.isDown('interact'), false)
})

test('wheel notches are ordered one-shot edges and never become held actions', (t) => {
  const { input, wheel, click } = setup()
  t.after(() => input.dispose())
  input.setEnabled(true)
  assert.equal(wheel(-1).defaultPrevented, false)
  click()
  assert.equal(wheel(0).defaultPrevented, false)
  assert.equal(wheel(Number.NaN).defaultPrevented, false)
  assert.equal(wheel(-1).defaultPrevented, true)
  wheel(100)
  wheel(1)
  const events = input.consumePressedEvents()
  assert.deepEqual(events.map(event => event.action), ['previousWeapon', 'nextWeapon', 'nextWeapon'])
  assert.ok(events.every((event, index) => index === 0 || event.sequence > events[index - 1].sequence))
  assert.equal(input.isDown('previousWeapon'), false)
  assert.equal(input.isDown('nextWeapon'), false)
  assert.equal(input.consumeReleased('nextWeapon'), false)
  assert.equal(input.consumePressed('nextWeapon'), false)
  assert.deepEqual(input.consumePressedEvents(), [])
})

test('per-action and ordered edge consumers share one queue without duplicating commands', (t) => {
  const { input, click, key, mouse, wheel } = setup()
  t.after(() => input.dispose())
  input.setEnabled(true)
  click()
  key('keydown', 'Digit2')
  key('keydown', 'Space')
  key('keyup', 'Space')
  wheel(1)
  key('keydown', 'Space')
  key('keyup', 'Space')
  key('keydown', 'Digit1')
  mouse('mousedown', 0)
  assert.equal(input.consumePressed('jump'), true, 'legacy consumption coalesces all edges for the action')
  assert.equal(input.consumePressed('jump'), false)
  const events = input.consumePressedEvents()
  assert.deepEqual(events.map(event => event.action), [
    'secondaryWeapon',
    'nextWeapon',
    'primaryWeapon',
    'fire',
  ])
  assert.ok(events.every((event, index) => index === 0 || event.sequence > events[index - 1].sequence))
  assert.equal(input.consumePressed('fire'), false)
  assert.equal(input.consumePressed('secondaryWeapon'), false)
  assert.equal(input.isDown('fire'), true, 'consuming an edge does not release its held state')
  assert.deepEqual(input.consumePressedEvents(), [])
})

test('keyboard and mouse bindings for one action release only after every physical input is up', (t) => {
  const { input, click, key, mouse } = setup({
    bindings: { KeyX: 'use', Mouse0: 'use' },
  })
  t.after(() => input.dispose())
  input.setEnabled(true)
  click()
  key('keydown', 'KeyX')
  mouse('mousedown', 0)
  assert.equal(input.consumePressedEvents().length, 1)
  key('keyup', 'KeyX')
  assert.equal(input.isDown('use'), true)
  assert.equal(input.consumeReleased('use'), false)
  mouse('mouseup', 0)
  assert.equal(input.isDown('use'), false)
  assert.equal(input.consumeReleased('use'), true)
})

test('unlock, window blur, visibility change and disable clear mouse, wheel and keyboard state together', (t) => {
  const { input, document, window, click, mouse, wheel, move, key } = setup()
  t.after(() => input.dispose())
  for (const clear of [
    () => document.exitPointerLock(),
    () => window.dispatchEvent(new Event('blur')),
    () => document.dispatchEvent(new Event('visibilitychange')),
    () => input.setEnabled(false),
  ]) {
    input.setEnabled(true)
    click()
    mouse('mousedown', 0)
    mouse('mouseup', 0)
    mouse('mousedown', 2)
    wheel(-1)
    move(7, -3)
    key('keydown', 'KeyW')
    key('keydown', 'Home')
    key('keyup', 'Home')
    clear()
    assert.equal(input.isDown('aim'), false)
    assert.equal(input.isDown('forward'), false)
    assert.deepEqual(input.consumePressedEvents(), [])
    assert.equal(input.consumeReleased('fire'), false)
    assert.equal(input.consumeReleased('respawn'), false)
    assert.deepEqual(input.consumeLook(), [0, 0])
  }
})

test('edge sequence stays monotonic after clearing input and disposal removes mouse listeners', (t) => {
  const { input, click, mouse, wheel, document } = setup()
  t.after(() => input.dispose())
  input.setEnabled(true)
  click()
  wheel(1)
  const before = input.consumePressedEvents()[0].sequence
  document.exitPointerLock()
  click()
  wheel(1)
  assert.ok(input.consumePressedEvents()[0].sequence > before)
  input.dispose()
  assert.equal(mouse('mousedown', 0).defaultPrevented, false)
  assert.equal(wheel(-1).defaultPrevented, false)
  assert.deepEqual(input.consumePressedEvents(), [])
  assert.equal(input.isDown('fire'), false)
})

test('explicit clear discards all transient input without disabling or releasing pointer lock', (t) => {
  const { input, element, document, click, mouse, wheel, move, key } = setup()
  t.after(() => input.dispose())
  input.setEnabled(true)
  click()
  mouse('mousedown', 0)
  mouse('mousedown', 2)
  mouse('mouseup', 2)
  key('keydown', 'KeyW')
  key('keydown', 'Home')
  key('keyup', 'Home')
  wheel(1)
  move(3, -5)
  input.clear()
  assert.equal(input.enabled, true)
  assert.equal(input.locked, true)
  assert.equal(document.pointerLockElement, element)
  assert.equal(document.activeElement, element)
  assert.equal(input.isDown('fire'), false)
  assert.equal(input.isDown('forward'), false)
  assert.deepEqual(input.consumePressedEvents(), [])
  assert.equal(input.consumeReleased('aim'), false)
  assert.equal(input.consumeReleased('respawn'), false)
  assert.deepEqual(input.consumeLook(), [0, 0])
  mouse('mousedown', 0)
  assert.equal(input.consumePressed('fire'), true, 'the same locked input remains usable after clearing')
})
