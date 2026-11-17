import { Disposer } from '../engine/runtime/core/disposer.js'
import armorHeavy from './assets/armory/armor-heavy.png'
import armorLight from './assets/armory/armor-light.png'
import armorRegen from './assets/armory/armor-regen.png'
import phoenixFireball from './assets/armory/phoenix-fireball.png'
import phoenixFlash from './assets/armory/phoenix-flash.png'
import phoenixWall from './assets/armory/phoenix-wall.png'
import phoenix from './assets/armory/phoenix.png'
import { weaponIcons } from './weapon-icons.js'

// Display order follows the range shop. The runtime catalog decides what can be equipped.
const shopColumns = [
  [
    {
      id: 'sidearms',
      name: '佩枪',
      weapons: [
        ['classic', '标配'],
        ['shorty', '短炮'],
        ['frenzy', '狂怒'],
        ['ghost', '鬼魅'],
        ['bandit', '追猎'],
        ['sheriff', '正义'],
      ],
    },
  ],
  [
    {
      id: 'smgs',
      name: '冲锋枪',
      weapons: [
        ['stinger', '蜂刺'],
        ['spectre', '骇灵'],
      ],
    },
    {
      id: 'shotguns',
      name: '霰弹枪',
      weapons: [
        ['bucky', '雄鹿'],
        ['judge', '判官'],
      ],
    },
  ],
  [
    {
      id: 'rifles',
      name: '步枪',
      weapons: [
        ['bulldog', '獠犬'],
        ['guardian', '戍卫'],
        ['warden', '悍狼'],
        ['phantom', '幻影'],
        ['vandal', '狂徒'],
      ],
    },
  ],
  [
    {
      id: 'snipers',
      name: '狙击枪',
      weapons: [
        ['marshal', '飞将'],
        ['outlaw', '莽侠'],
        ['operator', '冥驹'],
      ],
    },
    {
      id: 'heavy',
      name: '机枪',
      weapons: [
        ['ares', '战神'],
        ['odin', '奥丁'],
      ],
    },
  ],
  [
    {
      id: 'armor',
      name: '防护',
      armor: [
        ['light', '轻型护甲', armorLight],
        ['regen', '再生护甲', armorRegen],
        ['heavy', '重型护甲', armorHeavy],
      ],
    },
  ],
]

const progressLabels = Object.freeze({
  queued: '等待模拟提交',
  preparing: '正在准备资源',
  drawing: '正在切换武器',
  presenting: '等待展示确认',
  ready: '已装备',
  failed: '选择失败，可重试',
  superseded: '已由其他选择替代',
})
const pending = request => request && !['ready', 'failed', 'superseded'].includes(request.status)

function buildCatalog(content, catalog) {
  const document = content.ownerDocument
  const entries = new Map(catalog.map(entry => [entry.id, entry]))
  const cards = new Map()
  const columns = shopColumns.map((groups) => {
    const column = document.createElement('div')
    column.className = 'shop-column'
    if (groups.length > 1)
      column.classList.add('shop-column-split')
    const buttons = []
    for (const group of groups) {
      const section = document.createElement('section')
      section.className = `shop-category shop-category-${group.id}`
      section.setAttribute('aria-label', group.name)
      const heading = document.createElement('h3')
      heading.textContent = group.name
      const rows = document.createElement('div')
      rows.className = 'shop-category-rows'
      section.append(heading, rows)
      const gear = !!group.armor
      for (const [id, label, art] of group.armor ?? group.weapons) {
        const weapon = gear
          ? null
          : entries.get(id)
        const available = gear || !!weapon
        const image = gear ? art : weaponIcons[id]
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'shop-card'
        button.disabled = !available
        button.toggleAttribute('data-unavailable', !available)
        if (gear)
          button.dataset.armorOption = id
        else
          button.dataset.weapon = id
        if (weapon)
          button.dataset.slot = weapon.slotId
        button.setAttribute('aria-pressed', 'false')
        button.setAttribute('aria-label', available
          ? label
          : `${label}，未接入`)
        button.innerHTML = `
          <span class="shop-equipped" hidden></span>
          <img alt="" class="shop-weapon-icon">
          <span class="shop-card-label"><small class="shop-card-state"></small><span class="shop-card-name"></span></span>`
        button.querySelector('img').src = image
        button.querySelector('.shop-card-name').textContent = label
        const status = button.querySelector('.shop-card-state')
        status.textContent = available ? '免费' : '未接入'
        cards.set(id, {
          id,
          label,
          image,
          gear,
          weapon,
          category: group.name,
          available,
          button,
          status,
          badge: button.querySelector('.shop-equipped'),
        })
        buttons.push(button)
        rows.append(button)
      }
      column.append(section)
    }
    content.append(column)
    return buttons
  })
  return { cards, columns }
}

function weaponStats(stats) {
  const rows = [
    ['弹匣', `${stats.capacity} 发`],
    [
      '开火',
      stats.fireMode === 'auto'
        ? '自动'
        : '半自动',
    ],
    ['基础射速', `${Number(stats.fireRate.toFixed(2))} 发／秒`],
    ['换弹', `${stats.reloadTactical} 秒`],
    ['空仓换弹', `${stats.reloadEmpty} 秒`],
    [
      '开镜',
      stats.ads ? '支持' : '不支持',
    ],
  ]
  if (stats.adsFireRate)
    rows.push(['开镜射速', `${Number(stats.adsFireRate.toFixed(2))} 发／秒`])
  if (stats.fullFireRate)
    rows.push(['预热后射速', `${Number(stats.fullFireRate.toFixed(2))} 发／秒`])
  if (stats.pellets > 1)
    rows.push(['每发弹丸', `${stats.pellets} 颗`])
  return rows
}

/** Purchases and equipping both go through the scoped armory. */
export function mountWeaponShop({ ui, weapons, engine, onNotice }) {
  const document = ui.root.ownerDocument
  const owned = new Disposer()
  const catalog = weapons.readArmory().catalog
  const dialog = document.createElement('dialog')
  dialog.className = 'weapon-shop'
  dialog.setAttribute('aria-label', '武器商店')
  dialog.innerHTML = `
    <button type="button" class="shop-close" aria-label="关闭武器商店">×</button>
    <div class="shop-layout">
      <aside class="shop-context" aria-label="当前配装">
        <div class="shop-profile">
          <img class="shop-portrait" src="${phoenix}" alt="" loading="lazy">
          <div class="shop-profile-info">
            <h2>不死鸟</h2>
            <div class="shop-loadout-icons" aria-hidden="true">
              <span data-empty-shield></span><img data-shield-icon alt="" hidden>
              <img data-sidearm-icon alt="" hidden>
            </div>
          </div>
        </div>
        <p class="shop-economy">靶场免费选购</p>
        <dl class="shop-loadout">
          <dt>1 主武器</dt><dd data-primary></dd>
          <dt>2 手枪</dt><dd data-secondary></dd>
          <dt>3 刀</dt><dd>Classic 占位</dd>
          <dt>护甲</dt><dd data-player-armor></dd>
        </dl>
        <p class="shop-keys"><kbd>B</kbd> 商店 <kbd>Esc</kbd> 关闭</p>
        <p class="shop-feedback" role="status" aria-live="polite"></p>
      </aside>
      <div class="shop-market">
        <div class="shop-catalog" aria-label="装备分类"></div>
        <section class="shop-abilities" aria-label="不死鸟技能占位">
          <h3>技能</h3>
          <div class="shop-ability-cards">
            <div class="shop-ability"><kbd>C</kbd><img src="${phoenixWall}" alt=""><span>火冒三丈</span></div>
            <div class="shop-ability"><kbd>E</kbd><img src="${phoenixFireball}" alt=""><span>火热手感</span></div>
            <div class="shop-ability"><kbd>Q</kbd><img src="${phoenixFlash}" alt=""><span>闪光曲球</span></div>
          </div>
        </section>
      </div>
      <aside class="shop-details" aria-label="当前预览">
        <h3><span data-detail-name></span><small data-detail-id></small></h3>
        <div class="shop-detail-image"><img alt=""></div>
        <div class="shop-detail-copy">
          <p class="shop-detail-category"></p><dl class="shop-stats"></dl>
          <p class="shop-parameter-note"></p>
          <button type="button" class="shop-select"></button>
        </div>
      </aside>
    </div>`
  const content = dialog.querySelector('.shop-catalog')
  const { cards, columns } = buildCatalog(content, catalog)
  const primary = dialog.querySelector('[data-primary]')
  const secondary = dialog.querySelector('[data-secondary]')
  const playerArmor = dialog.querySelector('[data-player-armor]')
  const shieldIcon = dialog.querySelector('[data-shield-icon]')
  const emptyShield = dialog.querySelector('[data-empty-shield]')
  const sidearmIcon = dialog.querySelector('[data-sidearm-icon]')
  const details = dialog.querySelector('.shop-details')
  const detailName = details.querySelector('[data-detail-name]')
  const detailId = details.querySelector('[data-detail-id]')
  const detailImage = details.querySelector('img')
  const detailCategory = details.querySelector('.shop-detail-category')
  const stats = details.querySelector('.shop-stats')
  const note = details.querySelector('.shop-parameter-note')
  const action = details.querySelector('.shop-select')
  const feedback = dialog.querySelector('.shop-feedback')
  let candidate = null
  let equippedArmor = null
  let shownCandidate = null
  let shownRevision = -1
  let scopeId = null
  let requestId = 0
  let localError = ''
  let offFrame = null
  let modal
  const text = (node, value) => {
    if (node.textContent !== value)
      node.textContent = value
  }
  const detail = (item) => {
    text(detailName, item.label)
    text(detailId, item.gear
      ? ''
      : item.id.toUpperCase())
    detailImage.src = item.image
    details.toggleAttribute('data-armor', item.gear)
    text(detailCategory, item.category)
    const rows = item.gear
      ? []
      : weaponStats(item.weapon.stats)
    stats.replaceChildren(...rows.map(([label, value]) => {
      const row = document.createElement('div')
      const dt = document.createElement('dt')
      const dd = document.createElement('dd')
      dt.textContent = label
      dd.textContent = value
      row.append(dt, dd)
      return row
    }))
    text(note, item.gear
      ? '配装占位'
      : item.weapon.provisional ? '部分参数为靶场近似值。' : '')
  }
  const update = () => {
    if (!modal.isOpen)
      return
    const state = weapons.readArmory()
    if (scopeId !== state.scopeId) {
      scopeId = state.scopeId
      requestId = 0
      candidate = state.presentedDefinitionId ?? state.secondary ?? catalog[0]?.id ?? 'light'
      if (!cards.get(candidate)?.available)
        candidate = catalog.find(entry => cards.has(entry.id))?.id ?? 'light'
      localError = ''
    }
    if (shownRevision === state.revision && shownCandidate === candidate)
      return
    const armor = cards.get(equippedArmor)
    text(primary, cards.get(state.primary)?.label ?? '空')
    text(secondary, cards.get(state.secondary)?.label ?? '空')
    text(playerArmor, armor?.label ?? '无')
    if (armor)
      shieldIcon.src = armor.image
    shieldIcon.hidden = !armor
    emptyShield.hidden = !!armor
    const sidearm = cards.get(state.secondary)
    if (sidearm)
      sidearmIcon.src = sidearm.image
    sidearmIcon.hidden = !sidearm
    for (const card of cards.values()) {
      if (!card.available)
        continue
      const { id, button, badge, status, gear } = card
      const equipped = gear
        ? equippedArmor === id
        : state.presentedDefinitionId === id
      const held = gear
        ? equipped
        : state.primary === id || state.secondary === id
      const busy = pending(state.request) && state.request.definitionId === id
      button.disabled = !state.available
      button.setAttribute('aria-pressed', String(candidate === id))
      button.setAttribute('aria-busy', String(!!busy))
      button.toggleAttribute('data-owned', held)
      badge.hidden = !held
      text(badge, gear
        ? '已选择'
        : equipped ? '已装备' : '已持有')
      text(status, busy
        ? progressLabels[state.request.status]
        : state.request?.definitionId === id && state.request.status === 'failed'
          ? '失败 · 可重试'
          : held ? '' : '免费')
    }
    const item = cards.get(candidate)
    if (shownCandidate !== candidate)
      detail(item)
    const busy = !item.gear && pending(state.request) && state.request.definitionId === candidate
    const otherRequest = pending(state.request) && state.request.definitionId !== candidate
    const equipped = item.gear
      ? equippedArmor === candidate
      : state.presentedDefinitionId === candidate && state.canStartChallenge && !otherRequest
    action.disabled = !state.available || !!busy || equipped
    let actionText = '购买并装备'
    if (!state.available)
      actionText = '当前不可选择'
    else if (busy)
      actionText = progressLabels[state.request.status]
    else if (equipped)
      actionText = item.gear ? '当前已选择' : '当前已装备'
    else if (item.gear)
      actionText = '选择护甲'
    else if (state.primary === candidate || state.secondary === candidate)
      actionText = '装备'
    text(action, actionText)

    const requestText = state.request
      ? `${cards.get(state.request.definitionId)?.label ?? ''} · ${progressLabels[state.request.status]}${state.request.reason
        ? `：${state.request.reason}`
        : ''}`
      : ''
    const paused = state.paused && pending(state.request)
      ? '已暂停，恢复后处理选择。'
      : ''
    text(feedback, state.restriction ?? (localError || `${paused}${requestText}`))
    feedback.dataset.state = state.restriction || localError
      ? 'failed'
      : state.request?.status ?? 'idle'
    shownCandidate = candidate
    shownRevision = state.revision
  }
  const choose = (id) => {
    candidate = id
    if (localError)
      shownRevision = -1
    localError = ''
    update()
  }
  const submit = (id) => {
    const item = cards.get(id)
    const current = weapons.readArmory()
    if (!item?.available || !current.available)
      return
    choose(id)
    if (item.gear) {
      equippedArmor = id
    }
    else {
      if (pending(current.request) && current.request.definitionId === id)
        return
      const result = weapons.requestArmorySelection({ scopeId, requestId: ++requestId, definitionId: id })
      localError = result.accepted ? '' : result.reason
    }
    shownRevision = -1
    update()
  }
  for (const { id, available, button } of cards.values()) {
    if (!available)
      continue
    owned.listen(button, 'mouseenter', () => choose(id))
    owned.listen(button, 'focus', () => choose(id))
    owned.listen(button, 'click', () => submit(id))
  }
  owned.listen(content, 'keydown', (event) => {
    if (![
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
    ].includes(event.code)) {
      return
    }
    const columnIndex = columns.findIndex(column => column.includes(document.activeElement))
    if (columnIndex < 0)
      return
    event.preventDefault()
    const buttons = columns[columnIndex].filter(button => !button.disabled)
    const row = buttons.indexOf(document.activeElement)
    const horizontal = event.code === 'ArrowLeft' || event.code === 'ArrowRight'
    const step = event.code === 'ArrowRight' || event.code === 'ArrowDown'
      ? 1
      : -1
    if (horizontal) {
      const nextColumn = columns[columnIndex + step]?.filter(button => !button.disabled) ?? []
      nextColumn[Math.min(row, nextColumn.length - 1)]?.focus()
    }
    else {
      buttons[row + step]?.focus()
    }
  })
  owned.listen(action, 'click', () => submit(candidate))
  owned.listen(dialog.querySelector('.shop-close'), 'click', () => modal.close())
  modal = owned.add(ui.registerModal('weapon-shop', dialog, {
    onOpen() {
      shownRevision = -1
      update()
      offFrame = engine.events.on('frame', update)
    },
    onClose() {
      offFrame?.()
      offFrame = null
    },
  }))
  return {
    open() {
      const state = weapons.readArmory()
      if (!state.available) {
        onNotice?.(state.restriction)
        return false
      }
      modal.open()
      return true
    },
    dispose() {
      offFrame?.()
      owned.dispose()
    },
  }
}
