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

/** Free held-slot selector. The only gameplay intent is a scoped armory selection request. */
export function mountWeaponShop({ ui, weapons, engine, onNotice }) {
  const document = ui.root.ownerDocument
  const owned = new Disposer()
  const catalog = weapons.readArmory().catalog
  const bySlot = new Map(catalog.map(entry => [entry.slotId, entry]))
  const dialog = document.createElement('dialog')
  dialog.className = 'weapon-shop'
  dialog.setAttribute('aria-labelledby', 'weapon-shop-title')
  dialog.innerHTML = `
    <header class="shop-header">
      <div><p class="shop-eyebrow">RANGE / ARMORY</p><h2 id="weapon-shop-title">武器选择</h2></div>
      <p>练枪房军械库 <span data-shop-count></span> · 免费选择已有槽位</p>
      <button type="button" class="shop-close" aria-label="关闭武器商店">×</button>
    </header>
    <div class="shop-layout">
      <aside class="shop-context">
        <h3>靶场</h3><p class="shop-context-title">自由练习</p>
        <dl><dt>当前装备</dt><dd data-current-weapon>准备中</dd><dt>选择方式</dt><dd>免费 · 已有武器</dd></dl>
        <p class="shop-context-note">选择后商店保持打开。装备就绪前不会替换当前可用武器；不改变已有背包和剩余弹药。</p>
        <div class="shop-shortcuts" aria-label="武器快捷键"></div>
        <p class="shop-context-note"><kbd>B</kbd> 打开商店<br><kbd>Esc</kbd> 关闭窗口<br>再次 <kbd>Esc</kbd> 暂停</p>
      </aside>
      <div class="shop-catalog" aria-label="已有武器分类"></div>
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
    <footer class="shop-footer"><p class="shop-feedback" role="status" aria-live="polite"></p><p>候选高亮不代表已装备 · 伤害／护甲将在挑战阶段接入</p></footer>`
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
      button.setAttribute('aria-pressed', 'false')
      button.setAttribute('aria-label', `${entry.name} ${entry.id.toUpperCase()}，免费选择`)
      button.innerHTML = '<span class="shop-equipped" hidden>已装备</span><img alt="" class="shop-weapon-icon"><span class="shop-card-name"></span><span class="shop-card-state"></span><kbd class="shop-shortcut"></kbd>'
      button.querySelector('img').src = weaponIcons[entry.id]
      button.querySelector('.shop-card-name').textContent = entry.name
      button.querySelector('kbd').textContent = entry.shortcut
      cards.set(entry.slotId, {
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
  if (stack.children.length)
    content.append(stack)
  const shortcuts = dialog.querySelector('.shop-shortcuts')
  for (const entry of catalog) {
    const item = document.createElement('span')
    const key = document.createElement('kbd')
    key.textContent = entry.shortcut
    item.append(key, ` ${entry.id.toUpperCase()}`)
    shortcuts.append(item)
  }
  dialog.querySelector('[data-shop-count]').textContent = `／ ${catalog.length} 槽位`
  const current = dialog.querySelector('[data-current-weapon]')
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
      : '数值来自当前游戏配置；不显示尚未接入的伤害或护甲数据。')
  }
  const update = () => {
    if (!modal.isOpen)
      return
    const state = weapons.readArmory()
    if (scopeId !== state.scopeId) {
      scopeId = state.scopeId
      requestId = 0
      candidate = state.presentedSlotId ?? catalog[0]?.slotId
      localError = ''
    }
    if (!candidate)
      return
    if (shownRevision === state.revision && shownCandidate === candidate)
      return
    const active = bySlot.get(state.presentedSlotId)
    text(current, active
      ? `${active.name} / ${active.id.toUpperCase()}`
      : '准备中')
    for (const [slotId, card] of cards) {
      const selected = candidate === slotId
      if (card.button.getAttribute('aria-pressed') !== String(selected))
        card.button.setAttribute('aria-pressed', String(selected))
      const equipped = state.presentedSlotId === slotId
      if (card.badge.hidden === equipped)
        card.badge.hidden = !equipped
      const busy = pending(state.request) && state.request.slotId === slotId
      disabled(card.button, !state.available)
      if (card.button.getAttribute('aria-busy') !== String(!!busy))
        card.button.setAttribute('aria-busy', String(!!busy))
      text(card.state, busy
        ? progressLabels[state.request.status]
        : state.request?.slotId === slotId && state.request.status === 'failed'
          ? '失败 · 可重试'
          : '免费 · 选择')
    }
    if (shownCandidate !== candidate)
      detail(bySlot.get(candidate))
    const busyCandidate = pending(state.request) && state.request.slotId === candidate
    const hasOtherRequest = pending(state.request) && state.request.slotId !== candidate
    const alreadyEquipped = state.presentedSlotId === candidate && state.canStartChallenge && !hasOtherRequest
    disabled(select, !state.available || !!busyCandidate || alreadyEquipped)
    text(select, !state.available
      ? '当前不可选择'
      : busyCandidate
        ? progressLabels[state.request.status]
        : alreadyEquipped
          ? '当前已装备'
          : state.request?.slotId === candidate && state.request.status === 'failed'
            ? '免费重试'
            : '免费选择')
    const requestName = bySlot.get(state.request?.slotId)?.name ?? ''
    const requestText = state.request
      ? `${requestName} · ${progressLabels[state.request.status]}${state.request.reason
        ? `：${state.request.reason}`
        : ''}`
      : '悬停或聚焦查看详情，点击卡片免费选择。'
    text(feedback, state.restriction ?? (localError || `${state.paused && pending(state.request)
      ? '已暂停，恢复后处理选择。'
      : ''}${requestText}`))
    feedback.dataset.state = state.restriction || localError
      ? 'failed'
      : state.request?.status ?? 'idle'
    shownCandidate = candidate
    shownRevision = state.revision
  }
  const choose = (slotId) => {
    if (!bySlot.has(slotId))
      return
    candidate = slotId
    if (localError)
      shownRevision = -1
    localError = ''
    update()
  }
  const submit = (slotId) => {
    choose(slotId)
    const current = weapons.readArmory()
    if (pending(current.request) && current.request.slotId === slotId)
      return
    const result = weapons.requestArmorySelection({ scopeId, requestId: ++requestId, slotId })
    localError = result.accepted ? '' : result.reason
    shownRevision = -1
    update()
  }
  for (const [slotId, { button }] of cards) {
    owned.listen(button, 'mouseenter', () => choose(slotId))
    owned.listen(button, 'focus', () => choose(slotId))
    owned.listen(button, 'click', () => submit(slotId))
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
