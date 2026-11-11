import { Disposer } from '../../runtime/core/disposer.js'
import './inspection-panel.css'

/** 纯工具界面。场景相关的标签和操作全部由应用提供。 */
export function createInspectionPanel({ canvas, inspection }) {
  const owned = new Disposer()
  const hud = document.createElement('aside')
  const hasPlayer = !!inspection.player
  hud.className = 'room-inspection'
  hud.setAttribute('aria-label', '飞行与光照观察')
  hud.innerHTML = `
    <div class="inspection-heading"><strong>场景观察</strong><output class="inspection-speed"></output></div>
    <div class="inspection-actions">
      ${hasPlayer ? '<button type="button" data-action="player">玩家 V</button><button type="button" data-action="collision" aria-pressed="false">碰撞线框：关</button>' : ''}
      <button type="button" data-action="mode">切换轨道</button>
      <button type="button" data-action="focus"></button>
      <button type="button" data-action="reset">复位 R</button>
      <button type="button" data-action="pause">暂停漂浮</button>
      <button type="button" data-action="shadows" aria-pressed="true">阴影：开</button>
    </div>
    <p class="inspection-help"></p>`
  canvas.parentElement.append(hud)
  owned.add(() => hud.remove())
  const button = action => hud.querySelector(`[data-action="${action}"]`)
  button('focus').textContent = inspection.labels.focus
  const speed = hud.querySelector('.inspection-speed')
  const help = hud.querySelector('.inspection-help')
  const refresh = () => {
    const state = inspection.snapshot()
    const mode = state.cameraMode
    button('reset').textContent = mode === 'player'
      ? '重生 Home'
      : '复位 R'
    button('mode').textContent = mode === 'orbit'
      ? '切换飞行'
      : '切换轨道'
    if (hasPlayer) {
      button('player').textContent = mode === 'player'
        ? '飞行 V'
        : '玩家 V'
      button('collision').textContent = state.player.collisionDebug ? '碰撞线框：开' : '碰撞线框：关'
      button('collision').setAttribute('aria-pressed', String(state.player.collisionDebug))
    }
    button('pause').textContent = state.target.paused ? inspection.labels.resume : inspection.labels.pause
    button('shadows').textContent = state.shadows.enabled ? '阴影：开' : '阴影：关'
    button('shadows').setAttribute('aria-pressed', String(state.shadows.enabled))
    help.textContent = inspection.labels.help[mode]
    const text = mode === 'player'
      ? `玩家 ${Math.hypot(state.player.velocity[0], state.player.velocity[2]).toFixed(1)} m/s`
      : mode === 'fly'
        ? `飞行 ${state.flySpeed.toFixed(1)} m/s`
        : '轨道观察'
    if (speed.textContent !== text)
      speed.textContent = text
  }
  const actions = {
    player: () => inspection.setMode(inspection.snapshot().cameraMode === 'player'
      ? 'fly'
      : 'player'),
    collision: () => inspection.setCollisionDebug(!inspection.snapshot().player.collisionDebug),
    mode: () => inspection.setMode(inspection.snapshot().cameraMode === 'orbit'
      ? 'fly'
      : 'orbit'),
    focus: () => inspection.focusTarget(),
    reset: () => inspection.resetCamera(),
    pause: () => inspection.setPaused(!inspection.snapshot().target.paused),
    shadows: () => inspection.setShadows(!inspection.snapshot().shadows.enabled),
  }
  const perform = (action) => {
    actions[action]?.()
    refresh()
  }
  owned.listen(hud, 'click', event => perform(event.target.closest('button')?.dataset.action))
  owned.listen(canvas, 'keydown', (event) => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey)
      return
    if (event.code === 'KeyF')
      perform('focus')
    // Player R is an application input action, also available without this panel.
    else if (event.code === 'KeyR' && inspection.snapshot().cameraMode !== 'player')
      perform('reset')
    else if (event.code === 'KeyV' && hasPlayer)
      perform('player')
  })
  refresh()
  return {
    update: refresh,
    dispose: () => owned.dispose(),
  }
}
