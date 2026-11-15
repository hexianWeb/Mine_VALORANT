const crosshairStyle = {
  length: 3,
  thickness: 2,
  offset: 1,
  color: '#27eae0',
  hitColor: '#ffdf8b',
}

function mountCrosshair(canvas) {
  const viewport = canvas.ownerDocument.defaultView
  const context = canvas.getContext('2d')
  let hit = false
  let ratio
  let length
  let thickness
  let gap
  let left
  let top

  const draw = () => {
    const middle = length + (gap - thickness) / 2
    const far = length + gap
    context.fillStyle = hit ? crosshairStyle.hitColor : crosshairStyle.color
    context.fillRect(left, top + middle, length, thickness)
    context.fillRect(left + far, top + middle, length, thickness)
    context.fillRect(left + middle, top, thickness, length)
    context.fillRect(left + middle, top + far, thickness, length)
  }
  const resize = () => {
    ratio = viewport.devicePixelRatio
    length = Math.max(1, Math.round(crosshairStyle.length * ratio))
    thickness = Math.max(1, Math.round(crosshairStyle.thickness * ratio))
    gap = Math.round(2 * crosshairStyle.offset * ratio)
    // Match the gap and thickness parity so all four arms share an exact pixel center.
    gap += (gap + thickness) % 2
    const size = 2 * length + gap
    canvas.width = Math.round(viewport.innerWidth * ratio)
    canvas.height = Math.round(viewport.innerHeight * ratio)
    left = Math.round((canvas.width - size) / 2)
    top = Math.round((canvas.height - size) / 2)
    draw()
  }
  viewport.addEventListener('resize', resize)
  resize()
  return {
    setHit(value) {
      const changed = value !== hit
      hit = value
      if (ratio !== viewport.devicePixelRatio)
        resize()
      else if (changed)
        draw()
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
    crosshair.setHit(!!view.lastShot?.payload.impact.hit && view.presentationTime - view.lastShot.at < 0.12)
  }
  const off = engine.events.on('frame', update)
  update()
  return {
    dispose() {
      off()
      crosshair.dispose()
      root.remove()
    },
  }
}
