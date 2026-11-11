// @ts-check
import { Disposer } from '../../core/disposer.js'

/** @typedef {Readonly<Record<string, string>>} InputBindings Keyboard code, MouseN or WheelUp/Down to application-defined action. */
/** @typedef {{ action: string, sequence: number }} PressedEvent */

/**
 * 键盘 + Pointer Lock 的动作状态与输入边沿，由玩法在 input 阶段消费。
 * 仅在启用且元素聚焦或指针锁定时计入按键；鼠标输入仅在锁定时计入。
 * 绑定由调用方传入；缺省时不绑定任何动作。
 * @param {{ element: HTMLElement, bindings?: InputBindings }} options
 */
export function createInputSystem({ element, bindings = {} }) {
  const document = element.ownerDocument
  const window = document.defaultView
  const disposer = new Disposer()
  /** @type {Set<string>} */
  const held = new Set()
  /** @type {PressedEvent[]} */
  let pressed = []
  /** @type {Set<string>} */
  const released = new Set()
  let enabled = false
  let lookX = 0
  let lookY = 0
  let sequence = 0
  const locked = () => document.pointerLockElement === element
  const active = () => enabled && (locked() || document.activeElement === element)
  const controlBound = Object.hasOwn(bindings, 'ControlLeft') || Object.hasOwn(bindings, 'ControlRight')
  /** @param {string} action */
  const isDown = action => [...held].some(code => bindings[code] === action)
  /** @param {string} action */
  const press = action => pressed.push({ action, sequence: ++sequence })
  /** @param {string} code */
  const release = (code) => {
    if (held.delete(code) && !isDown(bindings[code]))
      released.add(bindings[code])
  }
  const clear = () => {
    held.clear()
    pressed = []
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
      press(action)
    held.add(event.code)
  })
  disposer.listen(window, 'keyup', (/** @type {KeyboardEvent} */ event) => {
    release(event.code)
  })
  disposer.listen(document, 'mousedown', (/** @type {MouseEvent} */ event) => {
    const code = `Mouse${event.button}`
    if (!enabled || !locked() || !Object.hasOwn(bindings, code))
      return
    event.preventDefault()
    const action = bindings[code]
    if (!isDown(action))
      press(action)
    held.add(code)
  })
  disposer.listen(document, 'mouseup', (/** @type {MouseEvent} */ event) => {
    if (!enabled || !locked())
      return
    release(`Mouse${event.button}`)
  })
  disposer.listen(document, 'wheel', (/** @type {WheelEvent} */ event) => {
    if (!enabled || !locked() || !Number.isFinite(event.deltaY) || event.deltaY === 0)
      return
    const code = event.deltaY < 0
      ? 'WheelUp'
      : 'WheelDown'
    if (!Object.hasOwn(bindings, code))
      return
    event.preventDefault()
    press(bindings[code])
  }, { passive: false })
  disposer.listen(document, 'contextmenu', (/** @type {MouseEvent} */ event) => {
    if (enabled && locked() && Object.hasOwn(bindings, 'Mouse2'))
      event.preventDefault()
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
    // Disabling gameplay may hand focus to an editor on this same canvas. Its asynchronous
    // pointer-lock exit must not undo that handoff; an explicit gameplay unlock still blurs.
    if (enabled)
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
    /** Discard transient input while preserving enabled state, focus and pointer lock. */
    clear,
    /** @param {string} action 消费该动作全部待处理按下边沿，返回是否存在；与有序消费共用队列。 */
    consumePressed(action) {
      const remaining = pressed.filter(event => event.action !== action)
      const consumed = remaining.length !== pressed.length
      pressed = remaining
      return consumed
    },
    /** @returns {PressedEvent[]} 按产生顺序消费所有剩余按下边沿，之后逐动作消费不会再返回它们。 */
    consumePressedEvents() {
      const events = pressed
      pressed = []
      return events
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
