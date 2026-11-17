import { defaultCrosshairProfile } from './crosshair-code.js'
import { mountCrosshairImport } from './crosshair-import.js'
import { createCrosshairRenderer } from './crosshair-renderer.js'

const phoenixAbilities = [
  { key: 'C', name: '火墙', path: 'M10 54h44 M14 50c-6-11 5-15 4-29 6 4 7 10 7 14 3-10 10-15 10-26 9 8 12 17 7 29 5-2 7-6 9-11 7 11 5 17 0 23 M26 49c0-6 5-8 7-15 3 4 6 9 4 15' },
  { key: 'Q', name: '闪光曲球', path: 'M8 34c3-15 13-24 27-24 13 0 22 7 22 18 0 10-8 17-17 17 M8 34l9-5 M8 34l2-10 M26 51l6 6 6-6 M45 23a7 7 0 1 0 0 14 7 7 0 1 0 0-14' },
  { key: 'E', name: '炽热手球', path: 'M32 8v9 M32 47v9 M8 32h9 M47 32h9 M15 15l7 7 M42 42l7 7 M15 49l7-7 M42 22l7-7 M32 20l4 7 8 5-8 4-4 8-4-8-8-4 8-5z' },
  { key: 'X', name: '再火一回', path: 'M32 53c-9-6-17-11-20-23l1-14 10 12 2-17 7 13 7-13 2 17 10-12 1 14c-3 12-11 17-20 23z M23 38l9 6 9-6 M32 30v14' },
]

function mountAbilityPlaceholders(container) {
  const document = container.ownerDocument
  for (const { key, name, path } of phoenixAbilities) {
    const cell = document.createElement('div')
    cell.className = 'ability-placeholder'
    cell.setAttribute('aria-label', `不死鸟 · ${name}（占位）`)
    cell.innerHTML = '<canvas width="64" height="64" aria-hidden="true"></canvas><span aria-hidden="true"></span><kbd></kbd>'
    const icon = cell.querySelector('canvas').getContext('2d')
    icon.strokeStyle = '#fff'
    icon.lineWidth = 3
    icon.lineJoin = 'round'
    icon.lineCap = 'round'
    icon.stroke(new Path2D(path))
    cell.querySelector('kbd').textContent = key
    container.append(cell)
  }
}

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
export function mountWeaponHud({ canvas, player, engine, ui, controls }) {
  const root = canvas.ownerDocument.createElement('div')
  root.className = 'weapon-hud'
  root.innerHTML = `
    <canvas class="weapon-crosshair" aria-hidden="true"></canvas>
    <div class="weapon-readout">
      <div class="hud-health" aria-label="生命值 100（占位）"><i aria-hidden="true"></i><b>100</b></div>
      <div class="hud-abilities" aria-label="不死鸟技能占位"></div>
      <div class="hud-ammo"><div class="hud-ammo-count" aria-label="弹匣和备用弹药"><b data-magazine></b><span data-reserve></span></div><strong></strong></div>
      <p class="hud-weapon-status" role="status"></p>
    </div>`
  ui.hud.append(root)
  mountAbilityPlaceholders(root.querySelector('.hud-abilities'))
  const name = root.querySelector('strong')
  const magazine = root.querySelector('[data-magazine]')
  const reserve = root.querySelector('[data-reserve]')
  const weaponStatus = root.querySelector('.hud-weapon-status')
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
    setText(name, weapon
      ? weapon.melee
        ? '爪刀 · Prime//2.0'
        : weapon.definitionId.toUpperCase()
      : '武器准备中')
    setText(magazine, weapon && !weapon.melee
      ? String(weapon.magazine)
      : '—')
    setText(reserve, weapon && !weapon.melee
      ? weapon.ammoPolicy === 'infinite-reserve'
        ? '∞'
        : String(weapon.reserve)
      : '')
    setText(weaponStatus, view.error ?? (view.skinError ? '换肤失败，按 K 重试' : ''))
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
