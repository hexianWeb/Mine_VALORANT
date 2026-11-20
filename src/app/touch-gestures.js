import { Disposer } from '../engine/runtime/core/disposer.js'

// A swipe across the short side turns ~126° at the default look sensitivity, independent of DPR.
const lookCountsPerShortSide = 4500
const deadZone = 0.12

/** Capture each contact separately: lifting the look finger must not release the stick or trigger. */
export function bindTouchGestures({ root, input, tap, unlockAudio }) {
  const owned = new Disposer()
  const window = root.ownerDocument.defaultView
  const contacts = new Map()
  let stickId = null
  let lookId = null

  const moveStick = ({ node, bounds }, x, y) => {
    const radius = bounds.width * 0.34
    const dx = x - (bounds.left + bounds.width / 2)
    const dy = y - (bounds.top + bounds.height / 2)
    const length = Math.hypot(dx, dy)
    const reach = Math.min(1, length / radius)
    const strength = Math.max(0, (reach - deadZone) / (1 - deadZone))
    const nx = dx / (length || 1)
    const ny = dy / (length || 1)
    input.setVirtualAxis('moveX', nx * strength)
    input.setVirtualAxis('moveZ', -ny * strength)
    node.style.setProperty('--stick-x', `${nx * reach * radius}px`)
    node.style.setProperty('--stick-y', `${ny * reach * radius}px`)
  }
  const end = (id) => {
    const contact = contacts.get(id)
    if (!contact)
      return
    contacts.delete(id)
    const { node } = contact
    if (node.dataset.action)
      input.setVirtualButton(id, node.dataset.action, false)
    if (id === stickId) {
      stickId = null
      input.setVirtualAxis('moveX', 0)
      input.setVirtualAxis('moveZ', 0)
      node.style.removeProperty('--stick-x')
      node.style.removeProperty('--stick-y')
    }
    if (id === lookId)
      lookId = null
    if (!Array.from(contacts.values()).some(other => other.node === node))
      node.removeAttribute('data-held')
    if (node.hasPointerCapture(id))
      node.releasePointerCapture(id)
    return node
  }
  owned.listen(root, 'pointerdown', (event) => {
    const node = event.target.closest('button, [data-stick], [data-look]')
    if (root.hidden || input.blocked || !node || node.disabled || event.button !== 0)
      return
    event.preventDefault()
    const id = event.pointerId
    const stick = node.hasAttribute('data-stick')
    if ((stick && stickId !== null) || contacts.has(id))
      return
    const contact = {
      node,
      x: event.clientX,
      y: event.clientY,
      bounds: stick
        ? node.getBoundingClientRect()
        : null,
    }
    contacts.set(id, contact)
    node.setPointerCapture(id)
    node.setAttribute('data-held', '')
    if (stick) {
      stickId = id
      moveStick(contact, contact.x, contact.y)
    }
    // A dedicated aiming finger takes priority over dragging the trigger, in either press order.
    if (node.hasAttribute('data-look') && (lookId === null || (!node.dataset.action && contacts.get(lookId)?.node.dataset.action)))
      lookId = id
    if (node.dataset.action)
      input.setVirtualButton(id, node.dataset.action, true)
  })
  owned.listen(root, 'pointermove', (event) => {
    const id = event.pointerId
    const contact = contacts.get(id)
    if (!contact)
      return
    const { clientX: x, clientY: y } = event
    if (stickId === id) {
      moveStick(contact, x, y)
    }
    else if (contact.node.hasAttribute('data-look')) {
      lookId ??= id
      if (lookId === id) {
        const scale = lookCountsPerShortSide / Math.min(window.innerWidth, window.innerHeight)
        input.addVirtualLook((x - contact.x) * scale, (y - contact.y) * scale)
        root.classList.add('has-looked')
      }
    }
    contact.x = x
    contact.y = y
  })
  owned.listen(root, 'pointerup', (event) => {
    const node = end(event.pointerId)
    if (!node)
      return
    // On touch devices user activation is granted on pointerup, not pointerdown on the canvas.
    if (event.isTrusted)
      unlockAudio()
    if (node.dataset.toggle || node.dataset.menu) {
      const { left, right, top, bottom } = node.getBoundingClientRect()
      if (event.clientX >= left && event.clientX <= right && event.clientY >= top && event.clientY <= bottom)
        tap(node)
    }
  })
  for (const type of ['pointercancel', 'lostpointercapture'])
    owned.listen(root, type, event => end(event.pointerId))
  owned.listen(root, 'contextmenu', event => event.preventDefault())
  // Native keyboard/assistive activation has no pointer stream. Pointer clicks are already handled.
  owned.listen(root, 'click', (event) => {
    const node = event.target.closest('button')
    if (event.detail !== 0 || !node || node.disabled || root.hidden || input.blocked)
      return
    if (node.dataset.action) {
      input.setVirtualButton('activate', node.dataset.action, true)
      input.setVirtualButton('activate', node.dataset.action, false)
    }
    else { tap(node) }
  })
  const reset = () => {
    for (const id of contacts.keys()) end(id)
  }
  owned.add(reset)
  return {
    reset,
    dispose: () => owned.dispose(),
  }
}
