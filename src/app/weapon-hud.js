import { defaultCrosshairProfile } from './crosshair-code.js'
import { mountCrosshairImport } from './crosshair-import.js'
import { createCrosshairRenderer } from './crosshair-renderer.js'

function mountCrosshair(canvas) {
  const viewport = canvas.ownerDocument.defaultView
  const draw = createCrosshairRenderer(canvas)
  let style = defaultCrosshairProfile.primary
  let hit = false
  let movement = 0
  let firing = 0
  let ratio

  const paint = () => draw(style, ratio, { movement, firing, hit })
  const resize = () => {
    ratio = viewport.devicePixelRatio
    canvas.width = Math.round(viewport.innerWidth * ratio)
    canvas.height = Math.round(viewport.innerHeight * ratio)
    paint()
  }
  viewport.addEventListener('resize', resize)
  resize()
  return {
    update(nextStyle, state, highlighted) {
      const { worldFov, spread, recoilPitch, recoilYaw } = state
      const pixels = viewport.innerHeight / (2 * Math.tan(worldFov * Math.PI / 360))
      const move = state.weapon?.moving && (nextStyle.inner?.movementScale || nextStyle.outer?.movementScale)
        ? Math.round(pixels * spread)
        : 0
      const fire = !nextStyle.fixedFiringOffset && (nextStyle.inner?.firingScale || nextStyle.outer?.firingScale)
        ? Math.round(pixels * Math.hypot(recoilPitch, recoilYaw))
        : 0
      const changed = nextStyle !== style || highlighted !== hit || move !== movement || fire !== firing
      style = nextStyle
      hit = highlighted
      movement = move
      firing = fire
      if (ratio !== viewport.devicePixelRatio)
        resize()
      else if (changed)
        paint()
    },
    dispose() { viewport.removeEventListener('resize', resize) },
  }
}

/** DOM presentation of already-presented weapon facts; it never submits gameplay commands. */
export function mountWeaponHud({ canvas, player, engine, ui, controls, withEditor = false }) {
  const root = canvas.ownerDocument.createElement('div')
  root.className = 'weapon-hud'
  root.innerHTML = '<canvas class="weapon-crosshair" aria-hidden="true"></canvas><div class="weapon-readout"><strong></strong><span></span><small>1 Phantom · 2 Classic · 3 Ghost · 4 Vandal · 5 Sheriff · 6 Judge · 7 Odin · 3–7 临时参数 · R 换弹 · T 检视 · K 换肤 · Home 重生</small></div>'
  ui.hud.append(root)
  root.classList.toggle('with-editor', withEditor)
  const name = root.querySelector('strong')
  const ammo = root.querySelector('.weapon-readout > span')
  const crosshair = mountCrosshair(root.querySelector('.weapon-crosshair'))
  let profile = defaultCrosshairProfile
  let enabled
  let importer
  const setText = (node, text) => {
    if (node.textContent !== text)
      node.textContent = text
  }
  const update = () => {
    const state = player.readHud()
    if (enabled !== state.enabled) {
      enabled = state.enabled
      root.hidden = !enabled
      importer.setEnabled(enabled)
    }
    const view = state.weapon
    if (!view)
      return
    const weapon = view.weapon
    const provisional = [
      'ghost',
      'vandal',
      'sheriff',
      'judge',
      'odin',
    ].includes(weapon?.definitionId)
      ? '（临时参数）'
      : ''
    setText(name, weapon
      ? `${weapon.definitionId.toUpperCase()} · ${view.skinId}${provisional}`
      : '武器准备中')
    setText(ammo, view.error
      ? `加载失败，可按槽位键重试：${view.error}`
      : weapon
        ? `${weapon.magazine} / ${weapon.reserve}${view.skinError ? ' · 换肤失败，按 K 重试' : ''}`
        : '正在加载…')
    crosshair.update(state.aiming ? profile.ads : profile.primary, state, view.hit)
  }
  importer = mountCrosshairImport({
    root,
    ui,
    getProfile: () => profile,
    onApply(next) {
      profile = next
      update()
    },
  })
  const off = engine.events.on('frame', update)
  const crosshairCanvas = root.querySelector('.weapon-crosshair')
  const inputState = (state) => {
    const hidden = state.mode !== 'gameplay'
    if (crosshairCanvas.hidden !== hidden)
      crosshairCanvas.hidden = hidden
  }
  const offInput = controls.subscribe(inputState)
  inputState(controls.read())
  update()
  return {
    openCrosshair: importer.open,
    dispose() {
      off()
      offInput()
      importer.dispose()
      crosshair.dispose()
      root.remove()
    },
  }
}
