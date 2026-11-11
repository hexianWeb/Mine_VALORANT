// @ts-check
import { Disposer } from '../../core/disposer.js'

/** @typedef {Readonly<Record<string, string>>} InputBindings Keyboard code to application-defined action. */

/**
 * 键盘 + Pointer Lock 的动作状态与输入边沿，由玩法在 input 阶段消费。
 * 仅在启用且元素聚焦或指针锁定时计入按键；鼠标视角仅在锁定时计入。
 * 键位由调用方传入；缺省时不绑定键盘动作。
 * @param {{ element: HTMLElement, bindings?: InputBindings }} options
 */
export function createInputSystem({ element, bindings = {} }) {
  const document = element.ownerDocument
  const window = document.defaultView
  const disposer = new Disposer()
  /** @type {Set<string>} */
  const held = new Set()
  /** @type {Set<string>} */
  const pressed = new Set()
  /** @type {Set<string>} */
  const released = new Set()
  let enabled = false
  let lookX = 0
  let lookY = 0
  const locked = () => document.pointerLockElement === element
  const active = () => enabled && (locked() || document.activeElement === element)
  const controlBound = Object.hasOwn(bindings, 'ControlLeft') || Object.hasOwn(bindings, 'ControlRight')
  /** @param {string} action */
  const isDown = action => [...held].some(code => bindings[code] === action)
  const clear = () => {
    held.clear()
    pressed.clear()
    released.clear()
    lookX = 0
    lookY = 0
  }
  const requestLock = () => {
    element.focus({ preventScroll: true })
    Promise.resolve(element.requestPointerLock({ unadjustedMovement: true }))
      .catch(() => Promise.resolve(element.requestPointerLock()).catch(() => {}))
  }
  disposer.listen(window, 'keydown', (/** @type {KeyboardEvent} */ event) => {
    if (!active() || !Object.hasOwn(bindings, event.code) || (event.ctrlKey && !controlBound) || event.altKey || event.metaKey)
      return
    event.preventDefault()
    const action = bindings[event.code]
    if (!event.repeat && !isDown(action))
      pressed.add(action)
    held.add(event.code)
  })
  disposer.listen(window, 'keyup', (/** @type {KeyboardEvent} */ event) => {
    if (held.delete(event.code) && !isDown(bindings[event.code]))
      released.add(bindings[event.code])
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
  disposer.listen(element, 'blur', () => {
    if (!locked())
      clear()
  })
  disposer.listen(document, 'visibilitychange', clear)
  const api = {
    name: 'input',
    isDown,
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
    /** @param {string} action 自上次消费以来是否从抬起变为按住。 */
    consumePressed(action) {
      return pressed.delete(action)
    },
    /** @param {string} action 自上次消费以来是否所有绑定键都已释放。 */
    consumeReleased(action) {
      return released.delete(action)
    },
    /** @returns {[number, number]} 自上次调用以来累积的鼠标计数 */
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
