/** DOM presentation of already-presented weapon facts; it never submits gameplay commands. */
export function mountWeaponHud({ canvas, player, engine }) {
  const root = canvas.ownerDocument.createElement('div')
  root.className = 'weapon-hud'
  root.innerHTML = '<span class="weapon-crosshair">+</span><div class="weapon-readout"><strong></strong><span></span><small>1 Phantom · 2 Classic · 3 Ghost · 4 Vandal · 3–4 临时参数 · R 换弹 · T 检视 · K 换肤 · Home 重生</small></div>'
  canvas.parentElement.append(root)
  const name = root.querySelector('strong')
  const ammo = root.querySelector('.weapon-readout > span')
  const crosshair = root.querySelector('.weapon-crosshair')
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
    crosshair.style.opacity = state.view.ads > 0.8
      ? '0'
      : '0.85'
    crosshair.style.transform = `translate(-50%, -50%) scale(${1 + Math.min(1, state.view.spread * 15)})`
    crosshair.classList.toggle('weapon-hit', !!view.lastShot?.payload.impact.hit && view.presentationTime - view.lastShot.at < 0.12)
  }
  const off = engine.events.on('frame', update)
  update()
  return {
    dispose() {
      off()
      root.remove()
    },
  }
}
