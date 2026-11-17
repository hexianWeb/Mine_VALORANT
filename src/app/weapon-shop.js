import { Disposer } from '../engine/runtime/core/disposer.js'
import { armoryCategories } from '../game/weapons/armory-catalog.js'
import { weaponIcons } from './weapon-icons.js'

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

/** Purchases and equipping both go through the scoped armory. */
export function mountWeaponShop({ ui, weapons, engine, onNotice }) {
  const document = ui.root.ownerDocument
  const owned = new Disposer()
  const catalog = weapons.readArmory().catalog
  const byId = new Map(catalog.map(entry => [entry.id, entry]))
  const dialog = document.createElement('dialog')
  dialog.className = 'weapon-shop'
  dialog.setAttribute('aria-labelledby', 'weapon-shop-title')
  dialog.innerHTML = `
    <header class="shop-header">
      <h2 id="weapon-shop-title">武器商店</h2>
      <p>靶场免费购买</p>
      <button type="button" class="shop-close" aria-label="关闭武器商店">×</button>
    </header>
    <div class="shop-layout">
      <aside class="shop-context">
        <h3>当前配装</h3>
        <dl>
          <dt>1 主武器</dt><dd data-primary></dd>
          <dt>2 手枪</dt><dd data-secondary></dd>
          <dt>3 刀</dt><dd>Classic 占位</dd>
          <dt>护甲</dt><dd data-player-armor>无</dd>
        </dl>
        <p class="shop-context-note">购买后替换对应槽位并装备。</p>
        <p class="shop-context-note"><kbd>B</kbd> 打开商店<br><kbd>Esc</kbd> 关闭窗口<br>再次 <kbd>Esc</kbd> 暂停</p>
      </aside>
      <div class="shop-catalog" aria-label="可购买的装备"></div>
      <aside class="shop-details" aria-label="候选武器详情">
        <h3><span data-detail-name></span><small data-detail-id></small></h3>
        <div class="shop-detail-image"><img alt="" data-detail-image></div>
        <div class="shop-detail-copy">
          <p class="shop-detail-category"></p><dl class="shop-stats"></dl>
          <p class="shop-parameter-note"></p>
          <button type="button" class="shop-select"></button>
        </div>
      </aside>
    </div>
    <footer class="shop-footer"><p class="shop-feedback" role="status" aria-live="polite"></p></footer>`
  const content = dialog.querySelector('.shop-catalog')
  const columns = []
  const stack = document.createElement('div')
  stack.className = 'shop-category-stack'
  const cards = new Map()
  for (const category of armoryCategories) {
    const entries = catalog.filter(entry => entry.category === category.id)
    if (!entries.length)
      continue
    const group = document.createElement('section')
    group.className = `shop-category shop-category-${category.id}`
    group.setAttribute('aria-label', category.name)
    const heading = document.createElement('h3')
    heading.textContent = category.name
    group.append(heading)
    const column = []
    for (const entry of entries) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'shop-card'
      button.dataset.slot = entry.slotId
      button.dataset.weapon = entry.id
      button.setAttribute('aria-pressed', 'false')
      button.setAttribute('aria-label', `${entry.name} ${entry.id.toUpperCase()}`)
      button.innerHTML = '<span class="shop-equipped" hidden></span><img alt="" class="shop-weapon-icon"><span class="shop-card-name"></span><span class="shop-card-state"></span>'
      button.querySelector('img').src = weaponIcons[entry.id]
      button.querySelector('.shop-card-name').textContent = entry.name
      cards.set(entry.id, {
        button,
        badge: button.querySelector('.shop-equipped'),
        state: button.querySelector('.shop-card-state'),
      })
      group.append(button)
      column.push(button)
    }
    if (['shotguns', 'heavy'].includes(category.id)) {
      stack.append(group)
      const combined = columns.find(column => column.stack)?.buttons
      if (combined)
        combined.push(...column)
      else
        columns.push({ stack: true, buttons: column })
    }
    else {
      content.append(group)
      columns.push({ stack: false, buttons: column })
    }
  }
  const armor = document.createElement('section')
  armor.className = 'shop-armor'
  armor.setAttribute('aria-label', '护甲占位')
  armor.innerHTML = `
    <h3>护甲</h3>
    <div class="shop-armor-options">
      <button type="button" class="shop-card shop-armor-card" data-armor-option="light" aria-pressed="false">
        <span class="shop-armor-icon" aria-hidden="true"></span><span class="shop-card-name">轻甲</span>
      </button>
      <button type="button" class="shop-card shop-armor-card" data-armor-option="heavy" aria-pressed="false">
        <span class="shop-armor-icon" aria-hidden="true"></span><span class="shop-card-name">重甲</span>
      </button>
    </div>
    <p>配装占位</p>`
  stack.append(armor)
  content.append(stack)
  const armorButtons = armor.querySelectorAll('button')
  const playerArmor = dialog.querySelector('[data-player-armor]')
  const primary = dialog.querySelector('[data-primary]')
  const secondary = dialog.querySelector('[data-secondary]')
  const detailName = dialog.querySelector('[data-detail-name]')
  const detailId = dialog.querySelector('[data-detail-id]')
  const detailImage = dialog.querySelector('[data-detail-image]')
  const detailCategory = dialog.querySelector('.shop-detail-category')
  const stats = dialog.querySelector('.shop-stats')
  const note = dialog.querySelector('.shop-parameter-note')
  const select = dialog.querySelector('.shop-select')
  const feedback = dialog.querySelector('.shop-feedback')
  let candidate = null
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
  const disabled = (node, value) => {
    if (node.disabled !== value)
      node.disabled = value
  }
  const detail = (entry) => {
    text(detailName, entry.name)
    text(detailId, entry.id.toUpperCase())
    detailImage.src = weaponIcons[entry.id]
    text(detailCategory, armoryCategories.find(category => category.id === entry.category).name)
    const values = [
      ['弹匣', `${entry.stats.capacity} 发`],
      [
        '开火',
        entry.stats.fireMode === 'auto'
          ? '自动'
          : '半自动',
      ],
      ['基础射速', `${Number(entry.stats.fireRate.toFixed(2))} 发／秒`],
      ['换弹', `${entry.stats.reloadTactical} 秒`],
      ['空仓换弹', `${entry.stats.reloadEmpty} 秒`],
      [
        '开镜',
        entry.stats.ads ? '支持' : '不支持',
      ],
    ]
    if (entry.stats.adsFireRate)
      values.push(['开镜射速', `${Number(entry.stats.adsFireRate.toFixed(2))} 发／秒`])
    if (entry.stats.fullFireRate)
      values.push(['预热后射速', `${Number(entry.stats.fullFireRate.toFixed(2))} 发／秒`])
    if (entry.stats.pellets > 1)
      values.push(['每发弹丸', `${entry.stats.pellets} 颗`])
    const nodes = values.map(([label, value]) => {
      const row = document.createElement('div')
      const dt = document.createElement('dt')
      const dd = document.createElement('dd')
      dt.textContent = label
      dd.textContent = value
      row.append(dt, dd)
      return row
    })
    stats.replaceChildren(...nodes)
    text(note, entry.provisional
      ? '当前运行参数含临时参考值与复用曲线，并非完整官方战斗数据。'
      : '')
  }
  const update = () => {
    if (!modal.isOpen)
      return
    const state = weapons.readArmory()
    if (scopeId !== state.scopeId) {
      scopeId = state.scopeId
      requestId = 0
      candidate = state.presentedDefinitionId ?? state.secondary ?? catalog[0]?.id
      localError = ''
    }
    if (!candidate)
      return
    if (shownRevision === state.revision && shownCandidate === candidate)
      return
    text(primary, byId.get(state.primary)?.name ?? '空')
    text(secondary, byId.get(state.secondary)?.name ?? '空')
    for (const button of armorButtons) disabled(button, !state.available)
    for (const [id, card] of cards) {
      const selected = candidate === id
      if (card.button.getAttribute('aria-pressed') !== String(selected))
        card.button.setAttribute('aria-pressed', String(selected))
      const equipped = state.presentedDefinitionId === id
      const held = state.primary === id || state.secondary === id
      if (card.badge.hidden === held)
        card.badge.hidden = !held
      text(card.badge, equipped ? '已装备' : '已持有')
      const busy = pending(state.request) && state.request.definitionId === id
      disabled(card.button, !state.available)
      if (card.button.getAttribute('aria-busy') !== String(!!busy))
        card.button.setAttribute('aria-busy', String(!!busy))
      text(card.state, busy
        ? progressLabels[state.request.status]
        : state.request?.definitionId === id && state.request.status === 'failed'
          ? '失败 · 可重试'
          : owned
            ? ''
            : (byId.get(id).slotId === 'primary'
                ? '替换主武器'
                : '替换手枪'))
    }
    if (shownCandidate !== candidate)
      detail(byId.get(candidate))
    const busyCandidate = pending(state.request) && state.request.definitionId === candidate
    const hasOtherRequest = pending(state.request) && state.request.definitionId !== candidate
    const alreadyEquipped = state.presentedDefinitionId === candidate && state.canStartChallenge && !hasOtherRequest
    disabled(select, !state.available || !!busyCandidate || alreadyEquipped)
    text(select, !state.available
      ? '当前不可选择'
      : busyCandidate
        ? progressLabels[state.request.status]
        : alreadyEquipped
          ? '当前已装备'
          : state.primary === candidate || state.secondary === candidate
            ? '装备'
            : '购买并装备')
    const requestName = byId.get(state.request?.definitionId)?.name ?? ''
    const requestText = state.request
      ? `${requestName} · ${progressLabels[state.request.status]}${state.request.reason
        ? `：${state.request.reason}`
        : ''}`
      : '点击武器卡片即可购买或装备。'
    text(feedback, state.restriction ?? (localError || `${state.paused && pending(state.request)
      ? '已暂停，恢复后处理选择。'
      : ''}${requestText}`))
    feedback.dataset.state = state.restriction || localError
      ? 'failed'
      : state.request?.status ?? 'idle'
    shownCandidate = candidate
    shownRevision = state.revision
  }
  const choose = (id) => {
    if (!byId.has(id))
      return
    candidate = id
    if (localError)
      shownRevision = -1
    localError = ''
    update()
  }
  const submit = (id) => {
    choose(id)
    const current = weapons.readArmory()
    if (pending(current.request) && current.request.definitionId === id)
      return
    const result = weapons.requestArmorySelection({ scopeId, requestId: ++requestId, definitionId: id })
    localError = result.accepted ? '' : result.reason
    shownRevision = -1
    update()
  }
  for (const [id, { button }] of cards) {
    owned.listen(button, 'mouseenter', () => choose(id))
    owned.listen(button, 'focus', () => choose(id))
    owned.listen(button, 'click', () => submit(id))
  }
  for (const button of armorButtons) {
    owned.listen(button, 'click', () => {
      if (!weapons.readArmory().available)
        return
      for (const option of armorButtons) option.setAttribute('aria-pressed', String(option === button))
      text(playerArmor, button.querySelector('.shop-card-name').textContent)
    })
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
    const columnIndex = columns.findIndex(column => column.buttons.includes(document.activeElement))
    if (columnIndex < 0)
      return
    event.preventDefault()
    const row = columns[columnIndex].buttons.indexOf(document.activeElement)
    const horizontal = event.code === 'ArrowLeft' || event.code === 'ArrowRight'
    const targetColumn = horizontal
      ? columns[Math.max(0, Math.min(columns.length - 1, columnIndex + (event.code === 'ArrowRight'
        ? 1
        : -1)))]
      : columns[columnIndex]
    const available = targetColumn.buttons.filter(button => !button.disabled)
    const target = Math.max(0, Math.min(available.length - 1, row + (horizontal
      ? 0
      : event.code === 'ArrowDown'
        ? 1
        : -1)))
    available[target]?.focus()
  })
  owned.listen(select, 'click', () => submit(candidate))
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
