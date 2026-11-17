import { Disposer } from '../engine/runtime/core/disposer.js'

export function mountInputOverlay({ ui, controls, onSettings }) {
  const owned = new Disposer()
  const root = ui.root.ownerDocument.createElement('section')
  root.className = 'input-overlay'
  root.innerHTML = `
    <div class="pause-card" role="dialog" aria-labelledby="range-pause-title" hidden>
      <header><h2 id="range-pause-title">靶场已暂停</h2></header>
      <div class="pause-body">
        <p class="pause-help">回到窗口后，点击「继续」恢复操控。</p>
        <div class="ui-actions"><button type="button" data-continue>继续</button><button type="button" data-settings><kbd>~</kbd> 设置</button></div>
      </div>
    </div>
    <button type="button" class="capture-hint">点击画面捕获鼠标 · B 商店 · ~ 设置</button>
    <p class="input-message" role="status"></p>`
  ui.hud.append(root)
  const card = root.querySelector('.pause-card')
  const resume = root.querySelector('[data-continue]')
  const settings = root.querySelector('[data-settings]')
  const capture = root.querySelector('.capture-hint')
  const message = root.querySelector('.input-message')
  const actions = card.querySelector('.ui-actions')
  const help = card.querySelector('.pause-help')
  const update = (state) => {
    const showPause = state.paused && !ui.topModal
    root.classList.toggle('is-paused', showPause)
    if (card.hidden === showPause) {
      card.hidden = !showPause
      if (showPause)
        resume.focus({ preventScroll: true })
    }
    capture.hidden = state.paused || state.mode !== 'unlocked' || !!ui.topModal
    resume.disabled = state.waiting
    const label = state.waiting
      ? '正在捕获鼠标…'
      : state.mode === 'editor'
        ? '继续观察'
        : '继续'
    if (resume.textContent !== label)
      resume.textContent = label
    const inCard = showPause && state.captureFailed
    help.hidden = inCard
    if (inCard && message.parentNode !== actions.parentNode)
      actions.before(message)
    else if (!inCard && message.parentNode !== root)
      root.append(message)
    message.classList.toggle('is-capture-error', state.captureFailed)
    message.hidden = !!ui.topModal
    if (message.textContent !== state.message)
      message.textContent = state.message
  }
  owned.listen(resume, 'click', controls.continue)
  owned.listen(capture, 'click', controls.capture)
  owned.listen(settings, 'click', onSettings)
  owned.add(controls.subscribe(update))
  owned.add(ui.events.on('modal', () => update(controls.read())))
  update(controls.read())
  return {
    dispose() {
      owned.dispose()
      root.remove()
    },
  }
}
