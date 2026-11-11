import { createInputSystem } from '../src/engine/runtime/function/input/input-system.js'

/** Browser event surface shared by input and player integration tests. */
export function setupInput(options = {}) {
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
      if (document.activeElement === element) {
        document.activeElement = null
        element.dispatchEvent(new Event('blur'))
      }
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
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      ...extra,
    })
    window.dispatchEvent(event)
    return event
  }
  return {
    window,
    document,
    element,
    key,
    move: (x, y) => document.dispatchEvent(Object.assign(new Event('mousemove'), { movementX: x, movementY: y })),
    input: createInputSystem({ element, ...options }),
  }
}
