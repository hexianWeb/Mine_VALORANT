import { Disposer } from '../../runtime/core/disposer.js'
import './inspection-panel.css'

/** 纯工具界面。场景相关的标签和操作全部由应用提供。 */
export function createInspectionPanel({ canvas, inspection, container = canvas.parentElement }) {
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
      <button type="button" data-action="reset">复位 R</button>
      <button type="button" data-action="shadows" aria-pressed="true">阴影：开</button>
    </div>
    <p class="inspection-help"></p>`
  container.append(hud)
  owned.add(() => hud.remove())
  const nodes = hud.querySelectorAll('[data-action]')
  const buttons = new Map([...nodes].map(node => [
    node.dataset.action,
    node,
  ]))
  const button = action => buttons.get(action)
  const text = (node, value) => {
    if (node.textContent !== value)
      node.textContent = value
  }
  const pressed = (node, value) => {
    if (node.getAttribute('aria-pressed') !== String(value))
      node.setAttribute('aria-pressed', String(value))
  }
  const speed = hud.querySelector('.inspection-speed')
  const help = hud.querySelector('.inspection-help')
  const refresh = () => {
    const state = inspection.readStatus()
    const mode = state.cameraMode
    text(button('reset'), mode === 'player'
      ? '重生 Home'
      : '复位 R')
    text(button('mode'), mode === 'orbit'
      ? '切换飞行'
      : '切换轨道')
    if (hasPlayer) {
      text(button('player'), mode === 'player'
        ? '飞行 V'
        : '玩家 V')
      text(button('collision'), state.player.collisionDebug ? '碰撞线框：开' : '碰撞线框：关')
      pressed(button('collision'), state.player.collisionDebug)
    }
    text(button('shadows'), state.shadows.enabled ? '阴影：开' : '阴影：关')
    pressed(button('shadows'), state.shadows.enabled)
    text(help, inspection.labels.help[mode])
    const speedText = mode === 'player'
      ? `玩家 ${Math.hypot(state.player.velocity[0], state.player.velocity[2]).toFixed(1)} m/s`
      : mode === 'fly'
        ? `飞行 ${state.flySpeed.toFixed(1)} m/s`
        : '轨道观察'
    text(speed, speedText)
  }
  const actions = {
    player: () => inspection.setMode(inspection.readStatus().cameraMode === 'player'
      ? 'fly'
      : 'player'),
    collision: () => inspection.setCollisionDebug(!inspection.readStatus().player.collisionDebug),
    mode: () => inspection.setMode(inspection.readStatus().cameraMode === 'orbit'
      ? 'fly'
      : 'orbit'),
    reset: () => inspection.resetCamera(),
    shadows: () => inspection.setShadows(!inspection.readStatus().shadows.enabled),
  }
  const perform = (action) => {
    actions[action]?.()
    refresh()
  }
  owned.listen(hud, 'click', event => perform(event.target.closest('button')?.dataset.action))
  owned.listen(canvas, 'keydown', (event) => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey)
      return
    // Player R is an application input action, also available without this panel.
    if (event.code === 'KeyR' && inspection.readStatus().cameraMode !== 'player')
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
