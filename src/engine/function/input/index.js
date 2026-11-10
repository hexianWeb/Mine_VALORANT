// @ts-check
import { Disposer } from '../../core/disposer.js'

/** Ctrl is avoided for crouch: the browser cannot block Ctrl+W while moving forward. */
const bindings = Object.freeze({
  KeyW: 'forward',
  KeyS: 'back',
  KeyA: 'left',
  KeyD: 'right',
  ShiftLeft: 'walk',
  ShiftRight: 'walk',
  KeyC: 'crouch',
  Space: 'jump',
})

/**
 * Phase 'input'. Keyboard + Pointer Lock -> intent; gameplay never reads DOM events.
 * Keys count while enabled and the element is focused or pointer-locked; mouse look only while locked.
 * @param {{ element: HTMLElement }} options
 */
export function createInputSystem({ element }) {
  const document = element.ownerDocument
  const window = document.defaultView
  const disposer = new Disposer()
  /** @type {Set<string>} */
  const held = new Set()
  const intent = {
    moveX: 0,
    moveZ: 0,
    walk: false,
    crouch: false,
  }
  let enabled = false
  let jumpQueued = false
  let lookX = 0
  let lookY = 0
  const locked = () => document.pointerLockElement === element
  const active = () => enabled && (locked() || document.activeElement === element)
  const pressed = action => [...held].some(code => bindings[code] === action)
  const refresh = () => {
    intent.moveX = Number(pressed('right')) - Number(pressed('left'))
    intent.moveZ = Number(pressed('forward')) - Number(pressed('back'))
    intent.walk = pressed('walk')
    intent.crouch = pressed('crouch')
  }
  const clear = () => {
    held.clear()
    jumpQueued = false
    lookX = 0
    lookY = 0
    refresh()
  }
  const requestLock = () => {
    element.focus({ preventScroll: true })
    Promise.resolve(element.requestPointerLock({ unadjustedMovement: true }))
      .catch(() => Promise.resolve(element.requestPointerLock()).catch(() => {}))
  }
  disposer.listen(window, 'keydown', (/** @type {KeyboardEvent} */ event) => {
    if (!active() || !(event.code in bindings) || event.altKey || event.metaKey)
      return
    event.preventDefault()
    if (bindings[event.code] === 'jump' && !event.repeat)
      jumpQueued = true
    held.add(event.code)
    refresh()
  })
  disposer.listen(window, 'keyup', (/** @type {KeyboardEvent} */ event) => {
    if (held.delete(event.code))
      refresh()
  })
  disposer.listen(document, 'mousemove', (/** @type {MouseEvent} */ event) => {
    if (!enabled || !locked())
      return
    lookX += event.movementX
    lookY += event.movementY
  })
  disposer.listen(element, 'click', () => {
    if (enabled && !locked())
      requestLock()
  })
  disposer.listen(document, 'pointerlockchange', () => {
    if (locked())
      return
    clear()
    element.blur()
  })
  disposer.listen(window, 'blur', clear)
  disposer.listen(document, 'visibilitychange', clear)
  const api = {
    name: 'input',
    intent,
    get locked() {
      return locked()
    },
    get enabled() {
      return enabled
    },
    /** @param {boolean} value */
    setEnabled(value) {
      enabled = !!value
      if (enabled)
        return
      clear()
      if (locked())
        document.exitPointerLock()
    },
    requestLock,
    consumeJump() {
      const queued = jumpQueued
      jumpQueued = false
      return queued
    },
    /** @returns {[number, number]} accumulated mouse counts since the last call */
    consumeLook() {
      const look = /** @type {[number, number]} */ ([lookX, lookY])
      lookX = 0
      lookY = 0
      return look
    },
    dispose() {
      api.setEnabled(false)
      disposer.dispose()
    },
  }
  return api
}
