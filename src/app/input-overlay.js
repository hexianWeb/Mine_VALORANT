import { Disposer } from '../engine/runtime/core/disposer.js'

export function mountInputOverlay({ ui, controls, onSettings }) {
  const owned = new Disposer()
  const root = ui.root.ownerDocument.createElement('section')
  root.className = 'input-overlay'
  root.innerHTML = `
    <div class="pause-card" hidden>
      <p class="ui-eyebrow">靶场 / PAUSED</p><h2>已暂停</h2>
      <p>模拟与展示时间已冻结。回到窗口不会自动继续。</p>
      <div class="ui-actions"><button type="button" data-continue>继续</button><button type="button" data-settings>F3 设置</button></div>
    </div>
    <button type="button" class="capture-hint">点击画面捕获鼠标 · F3 设置</button>
    <p class="input-message" role="status"></p>`
  ui.hud.append(root)
  const card = root.querySelector('.pause-card')
  const resume = root.querySelector('[data-continue]')
  const settings = root.querySelector('[data-settings]')
  const capture = root.querySelector('.capture-hint')
  const message = root.querySelector('.input-message')
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
