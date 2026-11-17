import { Disposer } from '../engine/runtime/core/disposer.js'
import { EventEmitter } from '../engine/runtime/core/events.js'

/** App input ownership, independent of player lifecycle and the engine's simulation clock. */
export function createUiInput({ canvas, input, player, engine, ui, onSettings, onShop }) {
  const document = canvas.ownerDocument
  const window = document.defaultView
  const owned = new Disposer()
  const events = new EventEmitter()
  const reasons = new Set()
  let focused = document.hasFocus?.() ?? true
  let unlockPending = false
  let waiting = false
  let resumeRequested = false
  let resuming = false
  let serial = 0
  let disposed = false
  let blocked = null
  let state = null
  let message = ''
  const interactive = () => focused && !document.hidden && (document.hasFocus?.() ?? true)
  const publish = () => {
    if (disposed)
      return
    const paused = engine.state === 'paused' || reasons.size > 0
    const mode = !player.enabled
      ? 'editor'
      : ui.topModal
        ? 'menu'
        : input.locked && !unlockPending && !paused && interactive()
          ? 'gameplay'
          : 'unlocked'
    const nextBlocked = mode !== 'gameplay'
    if (blocked !== nextBlocked) {
      blocked = nextBlocked
      input.setBlocked(blocked)
      player.setInputBlocked(blocked)
    }
    const pauseReasons = [...reasons].join(',')
    if (state && state.mode === mode && state.paused === paused && state.waiting === waiting
      && state.pauseReasons === pauseReasons && state.message === message) {
      return
    }
    state = Object.freeze({
      mode,
      paused,
      waiting,
      pauseReasons,
      message,
    })
    events.emit('change', state)
  }
  const release = () => {
    if (input.locked)
      unlockPending = true
    input.releaseLock()
  }
  const invalidateCapture = () => {
    serial++
    waiting = false
    resumeRequested = false
  }
  const pause = (reason) => {
    if (disposed)
      return
    reasons.add(reason)
    invalidateCapture()
    message = ''
    publish()
    release()
    if (engine.state === 'running')
      engine.pause()
    publish()
  }
  const failCapture = () => {
    waiting = false
    resumeRequested = false
    message = '未能捕获鼠标。请再次点击；游戏输入仍已隔离。'
    publish()
  }
  const lockChanged = () => {
    if (disposed)
      return
    if (!input.locked) {
      const unexpected = state?.mode === 'gameplay' && !unlockPending && !ui.topModal && player.enabled
      unlockPending = false
      if (unexpected)
        pause('pointer-lock')
      else
        publish()
      return
    }
    unlockPending = false
    const mayResume = waiting && resumeRequested
    if (!interactive() || ui.topModal || !player.enabled || (engine.state === 'paused' && !mayResume)) {
      release()
      publish()
      return
    }
    waiting = false
    resumeRequested = false
    message = ''
    if (mayResume && engine.state === 'paused') {
      reasons.clear()
      resuming = true
      try {
        engine.resume()
      }
      finally { resuming = false }
    }
    publish()
  }
  const requestCapture = (resume = false) => {
    if (disposed || waiting || ui.topModal || unlockPending || !interactive())
      return
    if (!player.enabled) {
      if (resume && engine.state === 'paused') {
        reasons.clear()
        resuming = true
        try {
          engine.resume()
        }
        finally { resuming = false }
        message = ''
        publish()
      }
      return
    }
    if (!input.enabled || (!resume && (engine.state !== 'running' || reasons.size)))
      return
    const request = ++serial
    waiting = true
    resumeRequested = resume
    message = ''
    publish()
    input.requestLock().then((accepted) => {
      if (disposed || request !== serial)
        return
      if (!accepted)
        failCapture()
      else if (input.locked)
        lockChanged()
    })
  }
  const sync = () => {
    if (!player.enabled && ui.topModal)
      ui.closeAll('editor')
    publish()
  }
  owned.add(ui.events.on('modal', ({ kind, reason }) => {
    if (kind === 'open') {
      invalidateCapture()
      publish()
      release()
    }
    else {
      publish()
      if (!ui.topModal && ['action', 'escape'].includes(reason) && engine.state === 'running' && !reasons.size)
        requestCapture()
    }
  }))
  owned.listen(window, 'keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey || !['F3', 'KeyB', 'Escape'].includes(event.code))
      return
    // B is ordinary text in the crosshair importer (e.g. 0b/1b fields), not a global command there.
    if (event.code === 'KeyB' && (ui.topModal || event.target?.closest?.('input, textarea, select, [contenteditable="true"]')))
      return
    if (!player.enabled && !ui.topModal)
      return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (event.repeat)
      return
    if (event.code === 'Escape') {
      if (ui.topModal)
        ui.closeTop('escape')
      else if (engine.state !== 'paused')
        pause('escape')
    }
    else if (event.code === 'F3') {
      onSettings?.()
    }
    else if (!ui.topModal) {
      if (onShop) {
        onShop()
      }
      else {
        message = '武器商店将在下一阶段接入；当前可用 1–7 切枪。'
        publish()
      }
    }
  }, { capture: true })
  owned.listen(canvas, 'click', (event) => {
    if (event.button === 0 && !input.locked && engine.state === 'running')
      requestCapture()
  })
  owned.listen(document, 'pointerlockchange', lockChanged)
  owned.listen(document, 'pointerlockerror', () => {
    // Promise-capable browsers may still be retrying without raw mouse input.
    if (waiting && !input.requestingLock)
      failCapture()
  })
  owned.listen(window, 'blur', () => {
    focused = false
    pause('focus')
  })
  owned.listen(window, 'focus', () => {
    focused = true
    publish() // Returning focus is never an implicit Continue.
  })
  owned.listen(document, 'visibilitychange', () => {
    if (document.hidden)
      pause('hidden')
    else
      publish()
  })
  owned.add(engine.events.on('start', () => {
    if (!interactive())
      pause(document.hidden ? 'hidden' : 'focus')
    else
      publish()
  }))
  owned.add(engine.events.on('pause', () => {
    player.setPaused(true)
    if (!reasons.size)
      reasons.add('external')
    invalidateCapture()
    publish()
    release()
  }))
  owned.add(engine.events.on('resume', () => {
    if (!resuming && reasons.size) {
      engine.pause()
      return
    }
    player.setPaused(false)
    publish()
  }))
  // Also covers tool-driven enable/disable outside createInspection().
  owned.add(engine.events.on('input', sync))
  publish()
  return {
    read: () => state,
    subscribe: callback => events.on('change', callback),
    continue: () => requestCapture(true),
    capture: () => requestCapture(),
    pause,
    announce(text) {
      message = String(text ?? '')
      publish()
    },
    sync,
    dispose() {
      if (disposed)
        return
      disposed = true
      invalidateCapture()
      owned.dispose()
      input.setBlocked(true)
      player.setInputBlocked(true)
      input.releaseLock()
      events.clear()
    },
  }
}
