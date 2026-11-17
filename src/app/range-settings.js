import { Disposer } from '../engine/runtime/core/disposer.js'
import { sensitivityLimits } from '../game/player/look-settings.js'
import { bindSensitivityStorage } from './sensitivity-storage.js'

/** Stage-one next-session draft only; no challenge/start/damage/ammo commands live in this view. */
export function mountRangeSettings({ ui, player, onCrosshair }) {
  const owned = new Disposer()
  const document = ui.root.ownerDocument
  const storage = owned.add(bindSensitivityStorage({
    settings: player.lookSettings,
    getStorage: () => document.defaultView.localStorage,
  }))
  let selection = Object.freeze({
    mode: 'shooting-test',
    difficulty: 'easy',
    targetKills: 50,
    armor: 0,
  })
  let modal
  const card = document.createElement('aside')
  card.className = 'range-status'
  card.setAttribute('aria-label', '靶场状态')
  card.innerHTML = `
    <h2>靶场</h2>
    <dl>
      <div><dt>当前</dt><dd>自由练习</dd></div>
      <div><dt>挑战</dt><dd>尚未接入</dd></div>
      <div><dt>预选模式</dt><dd data-mode></dd></div>
      <div><dt data-option-label></dt><dd data-option></dd></div>
      <div><dt>预选护甲</dt><dd data-armor></dd></div>
      <div><dt>灵敏度</dt><dd data-sensitivity></dd></div>
    </dl>
    <button type="button" data-open-settings>按 <kbd>F3</kbd> 更改设置</button>`
  ui.hud.append(card)
  const modeText = card.querySelector('[data-mode]')
  const optionLabel = card.querySelector('[data-option-label]')
  const optionText = card.querySelector('[data-option]')
  const armorText = card.querySelector('[data-armor]')
  const sensitivityText = card.querySelector('[data-sensitivity]')
  const dialog = document.createElement('dialog')
  dialog.className = 'settings-dialog'
  dialog.setAttribute('aria-labelledby', 'range-settings-title')
  dialog.innerHTML = `
    <header><div><p class="ui-eyebrow">RANGE / SETTINGS</p><h2 id="range-settings-title">靶场设置</h2></div><button type="button" data-close aria-label="关闭靶场设置">×</button></header>
    <p class="settings-note">当前为自由练习。挑战玩法尚未接入，以下规则仅作下一局预选，不改变场上机器人、护甲或供弹。</p>
    <fieldset class="range-selection"><legend>下一局预选</legend>
      <label>模式<select name="mode"><option value="shooting-test">射击测试（30 靶）</option><option value="elimination">消灭</option></select></label>
      <label data-difficulty>难度<select name="difficulty"><option value="easy">简单 · 2 秒</option><option value="medium">中等 · 1 秒</option><option value="hard">困难 · 0.5 秒</option></select></label>
      <label data-count hidden>目标击杀数<select name="targetKills"><option value="50">50 个</option><option value="100">100 个</option></select></label>
      <label>机器人护甲<select name="armor"><option value="0">无护甲（0）</option><option value="50">护甲 50</option></select></label>
      <p class="range-rule-summary"></p>
    </fieldset>
    <fieldset><legend>鼠标视角灵敏度</legend>
      <label for="range-sensitivity">倍率 <input id="range-sensitivity" name="sensitivity" type="number" min="0.01" max="5" step="0.01" inputmode="decimal"></label>
      <div class="sensitivity-steps">
        <button type="button" data-step="-0.1" aria-label="灵敏度减少 0.1">− 0.10</button>
        <button type="button" data-step="-0.01" aria-label="灵敏度减少 0.01">− 0.01</button>
        <button type="button" data-step="0.01" aria-label="灵敏度增加 0.01">+ 0.01</button>
        <button type="button" data-step="0.1" aria-label="灵敏度增加 0.1">+ 0.10</button>
      </div>
      <p class="sensitivity-status" role="status"></p>
      <p class="settings-help">默认 0.40 · 范围 0.01–5.00 · 本地保存 · 不单独设置 ADS 灵敏度</p>
    </fieldset>
    <footer class="ui-actions"><button type="button" data-crosshair-settings>准星设置</button><button type="button" data-close>完成</button></footer>`
  const mode = dialog.querySelector('[name="mode"]')
  const difficulty = dialog.querySelector('[name="difficulty"]')
  const count = dialog.querySelector('[name="targetKills"]')
  const armor = dialog.querySelector('[name="armor"]')
  const difficultyRow = dialog.querySelector('[data-difficulty]')
  const countRow = dialog.querySelector('[data-count]')
  const ruleSummary = dialog.querySelector('.range-rule-summary')
  const sensitivity = dialog.querySelector('[name="sensitivity"]')
  const status = dialog.querySelector('.sensitivity-status')
  const setText = (node, value) => {
    if (node.textContent !== value)
      node.textContent = value
  }
  const updateSensitivity = () => {
    const state = player.lookSettings.read()
    setText(sensitivityText, state.sensitivity.toFixed(2))
    if (!modal.isOpen)
      return
    if (document.activeElement !== sensitivity)
      sensitivity.value = state.requested.toFixed(2)
    setText(status, state.pending
      ? `待下一有效模拟步应用：${state.requested.toFixed(2)}（当前 ${state.sensitivity.toFixed(2)}）`
      : storage.read() === 'unavailable'
        ? `当前 ${state.sensitivity.toFixed(2)} · 本地保存不可用，本次仍生效`
        : `当前 ${state.sensitivity.toFixed(2)} · ${{
          saved: '已在本机保存',
          restored: '已恢复本机设置',
          local: '本地保存已启用',
        }[storage.read()]}`)
  }
  const updateSelection = () => {
    const shooting = selection.mode === 'shooting-test'
    setText(modeText, shooting ? '射击测试' : '消灭')
    setText(optionLabel, shooting ? '预选难度' : '预选数量')
    setText(optionText, shooting
      ? { easy: '简单', medium: '中等', hard: '困难' }[selection.difficulty]
      : `${selection.targetKills} 个`)
    setText(armorText, selection.armor === 0
      ? '无'
      : '50')
    difficultyRow.hidden = !shooting
    countRow.hidden = shooting
    mode.value = selection.mode
    difficulty.value = selection.difficulty
    count.value = String(selection.targetKills)
    armor.value = String(selection.armor)
    setText(ruleSummary, shooting
      ? '计划规则：场上恰好 1 只目标，30 次限时出靶机会；尚未运行。'
      : '计划规则：同时维持 10 只，杀一补一；1×1 米网格，周围 8 格留空；尚未运行。')
  }
  modal = owned.add(ui.registerModal('range-settings', dialog, {
    onOpen() {
      updateSelection()
      updateSensitivity()
    },
  }))
  owned.listen(card.querySelector('[data-open-settings]'), 'click', modal.open)
  for (const close of dialog.querySelectorAll('[data-close]'))
    owned.listen(close, 'click', () => modal.close())
  owned.listen(dialog.querySelector('[data-crosshair-settings]'), 'click', () => onCrosshair?.())
  owned.listen(dialog.querySelector('.range-selection'), 'change', () => {
    selection = Object.freeze({
      mode: mode.value,
      difficulty: difficulty.value,
      targetKills: Number(count.value),
      armor: Number(armor.value),
    })
    updateSelection()
  })
  const requestSensitivity = (value) => {
    if (!player.lookSettings.request(value)) {
      setText(status, '请输入 0.01–5.00 之间的有效数值。')
      sensitivity.setAttribute('aria-invalid', 'true')
      return
    }
    sensitivity.removeAttribute('aria-invalid')
    sensitivity.value = player.lookSettings.read().requested.toFixed(2)
    updateSensitivity()
  }
  owned.listen(sensitivity, 'change', () => requestSensitivity(sensitivity.valueAsNumber))
  for (const button of dialog.querySelectorAll('[data-step]')) {
    owned.listen(button, 'click', () => {
      const value = player.lookSettings.read().requested + Number(button.dataset.step)
      requestSensitivity(Math.min(sensitivityLimits.max, Math.max(sensitivityLimits.min, Math.round(value * 100) / 100)))
    })
  }
  owned.add(player.lookSettings.subscribe(updateSensitivity))
  updateSelection()
  updateSensitivity()
  return {
    toggle: () => modal.toggle(),
    readSelection: () => selection,
    setEnabled(enabled) {
      if (card.hidden === enabled)
        card.hidden = !enabled
      if (!enabled)
        modal.close('owner')
    },
    dispose() {
      owned.dispose()
      card.remove()
    },
  }
}
