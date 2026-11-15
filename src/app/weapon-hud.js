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
      const { worldFov, spread, recoilPitch, recoilYaw } = state.view
      const pixels = viewport.innerHeight / (2 * Math.tan(worldFov * Math.PI / 360))
      const move = state.gait.direction && (nextStyle.inner?.movementScale || nextStyle.outer?.movementScale)
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
export function mountWeaponHud({ canvas, player, engine }) {
  const root = canvas.ownerDocument.createElement('div')
  root.className = 'weapon-hud'
  root.innerHTML = '<canvas class="weapon-crosshair" aria-hidden="true"></canvas><div class="weapon-readout"><strong></strong><span></span><small>1 Phantom · 2 Classic · 3 Ghost · 4 Vandal · 5 Sheriff · 6 Judge · 7 Odin · 3–7 临时参数 · R 换弹 · T 检视 · K 换肤 · Home 重生</small></div>'
  canvas.parentElement.append(root)
  const name = root.querySelector('strong')
  const ammo = root.querySelector('.weapon-readout > span')
  const crosshair = mountCrosshair(root.querySelector('.weapon-crosshair'))
  let profile = defaultCrosshairProfile
  const update = () => {
    root.hidden = !player.enabled
    root.classList.toggle('with-editor', !!canvas.ownerDocument.querySelector('.debug-panel:not([hidden])'))
    const state = player.snapshot()
    const view = state.weapons?.view
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
    name.textContent = weapon
      ? `${weapon.definitionId.toUpperCase()} · ${view.skinId}${provisional}`
      : '武器准备中'
    ammo.textContent = view.error
      ? `加载失败，可按槽位键重试：${view.error}`
      : weapon
        ? `${weapon.magazine} / ${weapon.reserve}${view.skinError ? ' · 换肤失败，按 K 重试' : ''}`
        : '正在加载…'
    const hit = !!view.lastShot?.payload.impact.hit && view.presentationTime - view.lastShot.at < 0.12
    crosshair.update(state.view.aiming ? profile.ads : profile.primary, state, hit)
  }
  const importer = mountCrosshairImport({
    root,
    getProfile: () => profile,
    onApply(next) {
      profile = next
      update()
    },
  })
  const off = engine.events.on('frame', () => {
    importer.setEnabled(player.enabled)
    update()
  })
  update()
  return {
    dispose() {
      off()
      importer.dispose()
      crosshair.dispose()
      root.remove()
    },
  }
}
