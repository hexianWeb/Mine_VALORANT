import { Disposer } from '../engine/runtime/core/disposer.js'
import { bindTouchGestures } from './touch-gestures.js'
import { weaponIcons } from './weapon-icons.js'

// Drawn for the translucent touch buttons; no external HUD artwork or icon font.
const glyphs = {
  fire: '<g transform="rotate(-36 16 16)" fill="currentColor" stroke="none"><path d="M12 23V12c0-4 2-8 4-11 2 3 4 7 4 11v11zM12 25h8v4h-8z"/><path d="M6 14h1v12H6zM24 11h1v10h-1z" opacity=".65"/></g>',
  aim: '<circle cx="16" cy="16" r="9"/><path d="M16 2v8m0 12v8M2 16h8m12 0h8"/><circle cx="16" cy="16" r="1.8" fill="currentColor" stroke="none"/>',
  reload: '<path d="M6 18a10 10 0 1 0 2-9M4 6v7h7"/><path d="m14 11 5 1-2 10-5-1z" fill="currentColor" stroke="none"/>',
  skin: '<path d="M16 3a13 13 0 1 0 0 26c3 0 4-2 3-4l-1-2c-1-2 0-4 3-4h3c4 0 6-2 5-6C28 7 23 3 16 3Z"/><g fill="currentColor" stroke="none"><circle cx="9" cy="15" r="2"/><circle cx="14" cy="9" r="2"/><circle cx="22" cy="10" r="2"/></g>',
  inspect: '<path d="M2 16s5-9 14-9 14 9 14 9-5 9-14 9S2 16 2 16z"/><circle cx="16" cy="16" r="4"/>',
  jump: '<circle cx="19" cy="6" r="3" fill="currentColor" stroke="none"/><path d="m8 10 5 4 5-4 7-6m-9 9-4 7 7 2 1 6m-8-9-5 5-4-2" stroke-width="3.4"/>',
  crouch: '<circle cx="20" cy="9" r="3" fill="currentColor" stroke="none"/><path d="m16 14-5 5 9 1-5 5H8m8-11 5 4 6-3" stroke-width="3.4"/><path d="M5 29h20" opacity=".7"/>',
  walk: '<path d="M12 3c3 0 4 5 3 10l-1 3-6-1c-1-5 0-12 4-12Zm-4 14 6 1-1 4-5-1Zm14-7c3 0 4 6 2 10l-2 3-5-2c0-4 2-11 5-11Zm-6 13 5 2-2 4-4-2Z" fill="currentColor" stroke="none"/>',
  shop: '<path d="M5 10h22l-2 17H7zM11 12V9a5 5 0 0 1 10 0v3"/><path d="m13 19 3 3 5-6"/>',
  settings: '<path d="m13 4 6 0 1 4 3 1 4-1 3 5-3 3v3l2 3-3 4-4-1-3 2-1 3h-5l-1-4-3-1-4 1-3-5 3-3v-3l-2-3 3-4 4 1 3-2z" transform="translate(2 1) scale(.88)"/><circle cx="16" cy="16" r="4"/>',
  pause: '<path d="M8 5h5v22H8zm11 0h5v22h-5z" fill="currentColor" stroke="none"/>',
  knife: '<path d="M4 24C14 22 21 14 28 4c0 11-5 19-18 23l-3-2-2 3-2-2z" fill="currentColor" stroke="none"/>',
}

const icon = name => `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${glyphs[name]}</svg>`
const button = (name, label, attributes) => `<button type="button" class="touch-key" ${attributes} aria-label="${label}">${icon(name)}<span>${label}</span></button>`
const slots = [
  ['primary', '主武器'],
  ['secondary', '副武器'],
  ['tertiary', '近战'],
]

export function mountTouchControls({ ui, controls, input, weapons, engine, unlockAudio, onShop, onSettings }) {
  const owned = new Disposer()
  const root = ui.root.ownerDocument.createElement('section')
  root.className = 'touch-controls'
  root.setAttribute('aria-label', '触屏操控')
  root.innerHTML = `
    <div class="touch-look" data-look aria-hidden="true"></div>
    <p class="touch-look-hint">右侧滑动转向<span> · 推荐横屏</span></p>
    <div class="touch-tools touch-weapon-tools" role="group" aria-label="武器操作">
      ${button('skin', '换肤', 'data-action="cycleSkin"')}
      ${button('inspect', '检视', 'data-action="inspect"')}
    </div>
    <div class="touch-tools" role="group" aria-label="靶场菜单">
      ${button('shop', '商店', 'data-menu="shop"')}
      ${button('settings', '设置', 'data-menu="settings"')}
      ${button('pause', '暂停', 'data-menu="pause"')}
    </div>
    <div class="touch-left">
      ${button('fire', '开火', 'data-action="fire" aria-description="左侧开火键"')}
      <div class="touch-stick" data-stick role="group" aria-label="移动摇杆"><i></i><span>移动</span></div>
      ${button('walk', '静步', 'data-toggle="walk" aria-pressed="false"')}
    </div>
    <div class="touch-combat">
      ${button('fire', '开火', 'data-action="fire" data-look aria-description="按住时也可拖动转向"')}
      ${button('aim', '开镜', 'data-toggle="aim" aria-pressed="false"')}
      ${button('reload', '换弹', 'data-action="reload"')}
      ${button('jump', '跳跃', 'data-action="jump"')}
      ${button('crouch', '下蹲', 'data-toggle="crouch" aria-pressed="false"')}
    </div>
    <div class="touch-slots" role="group" aria-label="切换武器">
      ${slots.map(([slot, label]) => `<button type="button" data-action="${slot}Weapon" data-slot="${slot}" aria-label="${label}">
        ${slot === 'tertiary'
          ? icon('knife')
          : '<img alt="" draggable="false">'}<span>${label}</span></button>`).join('')}
    </div>`
  ui.root.classList.add('touch-ui')
  ui.hud.append(root)

  const toggles = root.querySelectorAll('[data-toggle]')
  const aim = root.querySelector('[data-toggle="aim"]')
  const reload = root.querySelector('[data-action="reload"]')
  const skin = root.querySelector('[data-action="cycleSkin"]')
  const inspect = root.querySelector('[data-action="inspect"]')
  const slotButtons = root.querySelectorAll('[data-slot]')
  const setToggle = (node, down) => {
    input.setVirtualButton(node.dataset.toggle, node.dataset.toggle, down)
    node.setAttribute('aria-pressed', String(down))
  }
  const menus = {
    shop: onShop,
    settings: onSettings,
    pause: () => controls.pause('touch'),
  }
  const gestures = owned.add(bindTouchGestures({
    root,
    input,
    unlockAudio,
    tap(node) {
      if (node.dataset.toggle)
        setToggle(node, node.getAttribute('aria-pressed') !== 'true')
      else
        menus[node.dataset.menu]?.()
    },
  }))
  const reset = () => {
    gestures.reset()
    for (const node of toggles) setToggle(node, false)
    input.clear()
  }
  let lastWeapon
  const updateWeapon = () => {
    if (root.hidden)
      return
    // Read the shop projection only when equipment changes, never a diagnostic snapshot per frame.
    const weapon = weapons?.readHud()?.weapon
    const instanceId = weapon?.instanceId ?? null
    if (lastWeapon === instanceId)
      return
    lastWeapon = instanceId
    const armory = weapons?.readArmory()
    setToggle(aim, false)
    aim.disabled = !armory?.catalog.find(item => item.id === weapon?.definitionId)?.stats.ads
    reload.disabled = !weapon || weapon.melee
    skin.disabled = !weapon
    inspect.disabled = !weapon
    for (const node of slotButtons) {
      const slot = node.dataset.slot
      node.setAttribute('aria-pressed', String(slot === armory?.presentedSlotId))
      const image = node.querySelector('img')
      const src = weaponIcons[armory?.[slot]]
      if (image && src && image.getAttribute('src') !== src)
        image.src = src
    }
  }
  const sync = (state) => {
    root.hidden = state.mode !== 'gameplay'
    if (root.hidden)
      reset()
    else
      updateWeapon()
  }
  owned.listen(root.ownerDocument.defaultView, 'resize', () => {
    if (!root.hidden)
      reset()
  })
  owned.add(controls.subscribe(sync))
  owned.add(engine.events.on('frame', updateWeapon))
  sync(controls.read())
  return {
    dispose() {
      reset()
      owned.dispose()
      ui.root.classList.remove('touch-ui')
      root.remove()
    },
  }
}
