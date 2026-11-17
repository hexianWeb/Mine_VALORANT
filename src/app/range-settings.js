import { Disposer } from '../engine/runtime/core/disposer.js'
import { stepSensitivity } from '../game/player/look-settings.js'
import { defaultChallengeSelection } from '../game/range-room/challenges/config.js'
import { bindSensitivityStorage } from './sensitivity-storage.js'

const difficultyLabels = { easy: '简单', medium: '中等', hard: '困难' }

export function mountRangeSettings({ ui, player, engine, challenge, readChallengeHud, onCrosshair }) {
  const owned = new Disposer()
  const document = ui.root.ownerDocument
  const storage = owned.add(bindSensitivityStorage({
    settings: player.lookSettings,
    getStorage: () => document.defaultView.localStorage,
  }))
  const card = document.createElement('aside')
  card.className = 'range-status'
  card.setAttribute('aria-label', '靶场状态')
  card.innerHTML = `
    <h2>靶场</h2>
    <dl>
      <div><dt>状态</dt><dd data-range-status></dd></div>
      <div><dt>挑战</dt><dd data-mode></dd></div>
      <div><dt data-progress-label>进度</dt><dd data-progress></dd></div>
      <div data-time-row hidden><dt>用时</dt><dd data-time></dd></div>
      <div><dt>机器人护甲</dt><dd data-armor></dd></div>
      <div><dt>无限备用弹药</dt><dd data-ammo-policy></dd></div>
      <div><dt>瞄准灵敏度</dt><dd data-sensitivity></dd></div>
    </dl>
    <button type="button" data-open-settings>按 <kbd>F3</kbd> <span data-settings-label>更改设置</span></button>
    <p class="range-shop-hint"><kbd>B</kbd> 武器商店</p>`
  ui.hud.append(card)
  const statusText = card.querySelector('[data-range-status]')
  const modeText = card.querySelector('[data-mode]')
  const progressLabel = card.querySelector('[data-progress-label]')
  const progressText = card.querySelector('[data-progress]')
  const timeRow = card.querySelector('[data-time-row]')
  const timeText = card.querySelector('[data-time]')
  const armorText = card.querySelector('[data-armor]')
  const ammoText = card.querySelector('[data-ammo-policy]')
  const sensitivityText = card.querySelector('[data-sensitivity]')
  const settingsButton = card.querySelector('[data-open-settings]')
  const settingsLabel = settingsButton.querySelector('[data-settings-label]')
  const shopHint = card.querySelector('.range-shop-hint')

  const dialog = document.createElement('dialog')
  dialog.className = 'settings-dialog'
  dialog.setAttribute('aria-labelledby', 'range-settings-title')
  dialog.innerHTML = `
    <header><h2 id="range-settings-title">靶场设置</h2><button type="button" data-close aria-label="关闭靶场设置">×</button></header>
    <p class="settings-note"></p>
    <fieldset class="range-selection"><legend>挑战设置</legend>
      <label>模式<select name="mode"><option value="shooting-test">射击测试（30 靶）</option><option value="elimination">消灭</option></select></label>
      <label data-difficulty>难度<select name="difficulty"><option value="easy">简单 · 2 秒</option><option value="medium">中等 · 1 秒</option><option value="hard">困难 · 0.5 秒</option></select></label>
      <label data-count hidden>目标击杀数<select name="targetKills"><option value="50">50 个</option><option value="100">100 个</option></select></label>
      <label>机器人护甲<select name="armor"><option value="0">无护甲（0）</option><option value="50">护甲 50</option></select></label>
      <p class="range-rule-summary"></p>
    </fieldset>
    <fieldset class="range-sensitivity"><legend>鼠标视角灵敏度</legend>
      <label for="range-sensitivity">倍率 <input id="range-sensitivity" name="sensitivity" type="number" min="0.01" max="5" step="0.01" inputmode="decimal"></label>
      <div class="sensitivity-steps">
        <button type="button" data-step="-0.1" aria-label="灵敏度减少 0.1">− 0.10</button>
        <button type="button" data-step="-0.01" aria-label="灵敏度减少 0.01">− 0.01</button>
        <button type="button" data-step="0.01" aria-label="灵敏度增加 0.01">+ 0.01</button>
        <button type="button" data-step="0.1" aria-label="灵敏度增加 0.1">+ 0.10</button>
      </div>
      <p class="sensitivity-status" role="status"></p>
    </fieldset>
    <footer class="ui-actions"><button type="button" data-cancel-challenge hidden>取消本局</button><button type="button" data-crosshair-settings>准星设置</button><button type="button" data-close>完成</button></footer>`
  const mode = dialog.querySelector('[name="mode"]')
  const difficulty = dialog.querySelector('[name="difficulty"]')
  const count = dialog.querySelector('[name="targetKills"]')
  const armor = dialog.querySelector('[name="armor"]')
  const difficultyRow = dialog.querySelector('[data-difficulty]')
  const countRow = dialog.querySelector('[data-count]')
  const ruleSummary = dialog.querySelector('.range-rule-summary')
  const selectionFields = dialog.querySelector('.range-selection')
  const sensitivityFields = dialog.querySelector('.range-sensitivity')
  const sensitivity = dialog.querySelector('[name="sensitivity"]')
  const status = dialog.querySelector('.sensitivity-status')
  const note = dialog.querySelector('.settings-note')
  const crosshair = dialog.querySelector('[data-crosshair-settings]')
  const cancel = dialog.querySelector('[data-cancel-challenge]')
  const setText = (node, value) => {
    if (node.textContent !== value)
      node.textContent = value
  }
  const setHidden = (node, hidden) => {
    if (node.hidden !== hidden)
      node.hidden = hidden
  }
  const setDisabled = (node, disabled) => {
    if (node.disabled !== disabled)
      node.disabled = disabled
  }
  const setValue = (node, value) => {
    if (node.value !== value)
      node.value = value
  }
  const selection = () => challenge?.selection ?? defaultChallengeSelection
  let modal
  const updateSensitivity = () => {
    if (!modal.isOpen)
      return
    const state = player.lookSettings.read()
    if (document.activeElement !== sensitivity)
      setValue(sensitivity, state.requested.toFixed(2))
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
  const updateModal = () => {
    const settings = selection()
    const shooting = settings.mode === 'shooting-test'
    const running = !!challenge?.running
    const cancelling = !!challenge?.cancelPending
    setHidden(difficultyRow, !shooting)
    setHidden(countRow, shooting)
    setValue(mode, settings.mode)
    setValue(difficulty, settings.difficulty)
    setValue(count, String(settings.targetKills))
    setValue(armor, String(settings.armor))
    setDisabled(selectionFields, running || !challenge)
    setDisabled(sensitivityFields, running)
    setDisabled(crosshair, running)
    setHidden(cancel, !running)
    setDisabled(cancel, cancelling)
    setText(ruleSummary, shooting
      ? '30 次出靶，场上同时 1 只。击杀和超时都会进入下一靶。'
      : '场上同时 10 只，杀一补一。达标时停表。')
    let instruction = '射击场景控制面板上的「开始」方框开启挑战。'
    if (cancelling) {
      instruction = engine.state === 'paused'
        ? '继续游戏后取消本局。'
        : '本局即将取消。'
    }
    else if (running) {
      instruction = '本局设置已锁定。打开设置期间，挑战继续进行。'
    }
    else if (!challenge) {
      instruction = '当前关卡没有可用的挑战。'
    }
    setText(note, instruction)
  }
  modal = owned.add(ui.registerModal('range-settings', dialog, {
    onOpen() {
      updateModal()
      updateSensitivity()
    },
  }))
  let lastModel
  const update = () => {
    const model = readChallengeHud()
    if (lastModel !== model || !model) {
      lastModel = model
      const settings = model ?? selection()
      const shooting = settings.mode === 'shooting-test'
      const running = model?.status === 'running'
      const completed = model?.status === 'completed'
      const capacityError = /^\[(?:Grid|RangeChallenge)\]/u.test(model?.reason ?? '')
      let phase = '待开始'
      if (capacityError)
        phase = '场景容量不足'
      else if (completed)
        phase = '已完成'
      else if (running)
        phase = '进行中'
      else if (model?.practice)
        phase = '自由练习'
      else if (!model?.startReady)
        phase = '准备中'
      setText(statusText, phase)
      setText(modeText, shooting
        ? `射击测试 · ${difficultyLabels[settings.difficulty]}`
        : `消灭 ${model?.goal ?? settings.targetKills} 个`)
      setText(progressLabel, running && shooting
        ? '当前靶 / 得分'
        : '击杀')
      const progress = model
        ? `${model.kills}/${model.goal}`
        : '—'
      setText(progressText, running && shooting
        ? `${model.settled + 1}/${model.goal} · ${model.kills}`
        : progress)
      setHidden(timeRow, shooting)
      setText(timeText, `${model?.timeLabel ?? '0.00'} 秒`)
      setText(armorText, settings.armor ? '50' : '无')
      const policy = model?.ammoPolicy ?? player.weapons?.readHud()?.weapon?.ammoPolicy
      setText(ammoText, policy === 'infinite-reserve'
        ? '已启用'
        : policy ? '关闭' : '—')
      setText(sensitivityText, model?.sensitivity ?? player.lookSettings.read().sensitivity.toFixed(2))
      setText(settingsLabel, running ? '查看本局' : '更改设置')
      setHidden(shopHint, running || !player.weapons)
      if (model && card.dataset.revision !== String(model.revision))
        card.dataset.revision = String(model.revision)
    }
    if (modal.isOpen)
      updateModal()
  }
  owned.listen(settingsButton, 'click', modal.open)
  for (const close of dialog.querySelectorAll('[data-close]'))
    owned.listen(close, 'click', () => modal.close())
  owned.listen(crosshair, 'click', () => {
    if (!challenge?.running)
      onCrosshair?.()
  })
  owned.listen(cancel, 'click', () => {
    challenge?.requestCancel()
    updateModal()
  })
  owned.listen(selectionFields, 'change', () => {
    if (!challenge?.running) {
      challenge?.prepare({
        mode: mode.value,
        difficulty: difficulty.value,
        targetKills: Number(count.value),
        armor: Number(armor.value),
      })
    }
    updateModal()
  })
  owned.listen(sensitivity, 'change', () => {
    if (challenge?.running)
      return
    if (!player.lookSettings.request(sensitivity.valueAsNumber)) {
      setText(status, '请输入 0.01–5.00 之间的有效数值。')
      sensitivity.setAttribute('aria-invalid', 'true')
      return
    }
    sensitivity.removeAttribute('aria-invalid')
    setValue(sensitivity, player.lookSettings.read().requested.toFixed(2))
    updateSensitivity()
  })
  for (const button of dialog.querySelectorAll('[data-step]')) {
    owned.listen(button, 'click', () => {
      if (!challenge?.running)
        stepSensitivity(player.lookSettings, Number(button.dataset.step))
    })
  }
  owned.add(player.lookSettings.subscribe(updateSensitivity))
  owned.add(engine.events.on('frame', update))
  update()
  return {
    toggle: () => modal.toggle(),
    setEnabled(enabled) {
      setHidden(card, !enabled)
      if (!enabled)
        modal.close('owner')
    },
    dispose() {
      owned.dispose()
      card.remove()
    },
  }
}
