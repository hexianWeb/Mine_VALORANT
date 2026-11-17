import { Disposer } from '../engine/runtime/core/disposer.js'
import { EventEmitter } from '../engine/runtime/core/events.js'

/** One level-owned DOM host. Native dialogs provide top-layer rendering and focus containment. */
export function createUiHost({ canvas, debugContainer = null }) {
  const document = canvas.ownerDocument
  const owned = new Disposer()
  const events = new EventEmitter()
  const root = document.createElement('div')
  root.className = 'app-ui'
  root.innerHTML = '<div class="ui-hud-layer"></div><div class="ui-debug-layer"></div><div class="ui-modal-layer"></div>'
  canvas.parentElement.append(root)
  const hud = root.querySelector('.ui-hud-layer')
  const debug = root.querySelector('.ui-debug-layer')
  const modals = root.querySelector('.ui-modal-layer')
  const entries = new Map()
  const stack = []
  let disposed = false
  if (debugContainer) {
    const parent = debugContainer.parentElement
    const next = debugContainer.nextSibling
    debug.append(debugContainer)
    owned.add(() => parent?.insertBefore(debugContainer, next?.parentElement === parent
      ? next
      : null))
  }
  const changed = (kind, reason) => events.emit('modal', { kind, reason, top: stack.at(-1)?.id ?? null })
  const focus = entry => (entry.dialog.querySelector('[autofocus], button, input, select, textarea') ?? entry.dialog).focus({ preventScroll: true })
  // Native dialogs make the rest of the page inert, but Tab may still leave for browser chrome.
  owned.listen(document, 'keydown', (event) => {
    const entry = stack.at(-1)
    if (event.code !== 'Tab' || !entry?.dialog.open)
      return
    const nodes = entry.dialog.querySelectorAll('button, input, select, textarea, a[href], [tabindex]')
    const candidates = [...nodes]
      .filter(node => !node.disabled && node.tabIndex >= 0 && node.getClientRects().length)
    event.preventDefault()
    const index = candidates.indexOf(document.activeElement)
    const next = event.shiftKey
      ? index <= 0
        ? candidates.length - 1
        : index - 1
      : (index + 1) % candidates.length
    ;(candidates[next] ?? entry.dialog).focus({ preventScroll: true })
  }, { capture: true })
  const close = (entry, reason = 'action') => {
    const index = stack.indexOf(entry)
    if (index < 0)
      return
    // Removing an owner also removes any modal layered above it.
    for (const child of stack.slice(index + 1).reverse()) close(child, 'owner')
    stack.pop()
    entry.dialog.close()
    entry.onClose?.()
    const previous = stack.at(-1)
    if (entry.returnFocus?.isConnected && (!previous || previous.dialog.contains(entry.returnFocus)))
      entry.returnFocus.focus({ preventScroll: true })
    else if (previous)
      focus(previous)
    changed('close', reason)
  }
  const api = {
    root,
    hud,
    debug,
    modals,
    events,
    get topModal() { return stack.at(-1)?.id ?? null },
    registerModal(id, dialog, { onOpen, onClose } = {}) {
      if (entries.has(id))
        throw new Error(`[UI] Duplicate modal: ${id}`)
      modals.append(dialog)
      const entry = {
        id,
        dialog,
        onOpen,
        onClose,
        returnFocus: null,
      }
      entries.set(id, entry)
      const cancel = (event) => {
        event.preventDefault()
        if (stack.at(-1) === entry)
          close(entry, 'escape')
      }
      // Covers native form method="dialog" and consumers closing a dialog themselves.
      const nativeClose = () => {
        if (!dialog.open)
          close(entry)
      }
      dialog.addEventListener('cancel', cancel)
      dialog.addEventListener('close', nativeClose)
      const handle = {
        get isOpen() { return stack.includes(entry) },
        open() {
          if (disposed || stack.includes(entry))
            return
          entry.returnFocus = document.activeElement
          stack.push(entry)
          // Block gameplay before asking the browser to unlock/show the modal.
          changed('open', 'action')
          try {
            dialog.showModal()
            onOpen?.()
            focus(entry)
          }
          catch (error) {
            close(entry, 'error')
            throw error
          }
        },
        close: (reason = 'action') => close(entry, reason),
        toggle() {
          if (handle.isOpen)
            handle.close()
          else
            handle.open()
        },
        dispose() {
          close(entry, 'dispose')
          entries.delete(id)
          dialog.removeEventListener('cancel', cancel)
          dialog.removeEventListener('close', nativeClose)
          dialog.remove()
        },
      }
      owned.add(handle)
      return handle
    },
    closeTop: (reason = 'action') => {
      const entry = stack.at(-1)
      if (entry)
        close(entry, reason)
    },
    closeAll(reason = 'owner') {
      for (const entry of [...stack].reverse()) close(entry, reason)
    },
    dispose() {
      if (disposed)
        return
      disposed = true
      events.clear()
      owned.dispose()
      root.remove()
    },
  }
  return api
}
