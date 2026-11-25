import { Disposer } from '../engine/runtime/core/disposer.js'
import { stepSensitivity } from '../game/player/look-settings.js'
import { defaultChallengeSelection } from '../game/range-room/challenges/config.js'
import { bindSensitivityStorage } from './sensitivity-storage.js'

const difficultyLabels = { easy: '简单', medium: '中等', hard: '困难' }

export function mountRangeSettings({ ui, player, engine, challenge, readChallengeHud, onCrosshair, inputLayout }) {
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
    <button type="button" data-open-settings><kbd>~</kbd> <span data-settings-label>更改设置</span></button>
    <dl>
      <div><dt>挑战</dt><dd data-mode></dd></div>
      <div><dt>机器人护甲</dt><dd data-armor></dd></div>
      <div><dt>无限弹药</dt><dd data-ammo-policy></dd></div>
      <div data-status-row hidden><dt>状态</dt><dd data-range-status></dd></div>
      <div data-progress-row hidden><dt data-progress-label>进度</dt><dd data-progress></dd></div>
      <div data-time-row hidden><dt>用时</dt><dd data-time></dd></div>
    </dl>`
  ui.hud.append(card)
  const statusText = card.querySelector('[data-range-status]')
  const statusRow = card.querySelector('[data-status-row]')
  const modeText = card.querySelector('[data-mode]')
  const progressLabel = card.querySelector('[data-progress-label]')
  const progressText = card.querySelector('[data-progress]')
  const progressRow = card.querySelector('[data-progress-row]')
  const timeRow = card.querySelector('[data-time-row]')
  const timeText = card.querySelector('[data-time]')
  const armorText = card.querySelector('[data-armor]')
  const ammoText = card.querySelector('[data-ammo-policy]')
  const settingsButton = card.querySelector('[data-open-settings]')
  const settingsLabel = settingsButton.querySelector('[data-settings-label]')

  const dialog = document.createElement('dialog')
  dialog.className = 'settings-dialog'
  dialog.setAttribute('aria-labelledby', 'range-settings-title')
  dialog.innerHTML = `
    <header><h2 id="range-settings-title">靶场</h2><button type="button" data-close aria-label="关闭靶场设置">×</button></header>
    <div class="settings-body">
    <fieldset class="range-selection" aria-label="挑战设置">
      <section><h3>速度</h3>
        <button type="button" data-difficulty="easy">简单</button>
        <button type="button" data-difficulty="medium">中等</button>
        <button type="button" data-difficulty="hard">困难</button>
      </section>
      <section><h3>连续击败</h3>
        <button type="button" data-count="50">消灭 50</button>
        <button type="button" data-count="100">消灭 100</button>
      </section>
      <section><h3>机器人护甲</h3>
        <div class="settings-options">
          <button type="button" data-armor-choice="50">开</button>
          <button type="button" data-armor-choice="0">关</button>
        </div>
      </section>
      <section><h3>无限备用弹药</h3><p class="settings-ammo"></p></section>
    </fieldset>
    <fieldset class="range-sensitivity"><legend>视角灵敏度</legend>
      <label for="range-sensitivity">倍率 <input id="range-sensitivity" name="sensitivity" type="number" min="0.01" max="5" step="0.01" inputmode="decimal"></label>
      <div class="sensitivity-steps">
        <button type="button" data-step="-0.1" aria-label="灵敏度减少 0.1">− 0.10</button>
        <button type="button" data-step="-0.01" aria-label="灵敏度减少 0.01">− 0.01</button>
        <button type="button" data-step="0.01" aria-label="灵敏度增加 0.01">+ 0.01</button>
        <button type="button" data-step="0.1" aria-label="灵敏度增加 0.1">+ 0.10</button>
      </div>
      <p class="sensitivity-status" role="status"></p>
    </fieldset>
    <fieldset class="range-export"><legend>本地试玩数据</legend>
      <label>已结束的挑战 <select data-playtest-run></select></label>
      <label>玩家编号（选填） <input data-playtest-player placeholder="例如 P01" maxlength="32" autocomplete="off"></label>
      <button type="button" data-export-csv disabled>导出所选局 CSV</button>
      <small data-export-status role="status">保留本次打开靶场的最近 10 局（含中途取消）；刷新前请下载。</small>
    </fieldset>
    <p class="settings-note"></p>
    <footer class="ui-actions"><button type="button" data-cancel-challenge hidden>取消本局</button><button type="button" data-crosshair-settings>准星设置</button><button class="settings-done" type="button" data-close>完成</button></footer>
    </div>`
  const selectionFields = dialog.querySelector('.range-selection')
  const choiceButtons = [
    ...selectionFields.querySelectorAll('button'),
  ]
  const ammoSetting = dialog.querySelector('.settings-ammo')
  const sensitivityFields = dialog.querySelector('.range-sensitivity')
  const sensitivity = dialog.querySelector('[name="sensitivity"]')
  const status = dialog.querySelector('.sensitivity-status')
  const note = dialog.querySelector('.settings-note')
  const crosshair = dialog.querySelector('[data-crosshair-settings]')
  const cancel = dialog.querySelector('[data-cancel-challenge]')
  const runSelect = dialog.querySelector('[data-playtest-run]')
  const playerId = dialog.querySelector('[data-playtest-player]')
  const exportButton = dialog.querySelector('[data-export-csv]')
  const exportStatus = dialog.querySelector('[data-export-status]')
  let lastChoices = null
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
    const choices = challenge?.playtests?.choices
    if (lastChoices !== choices) {
      lastChoices = choices
      runSelect.replaceChildren()
      for (const run of choices ?? []) {
        const option = document.createElement('option')
        option.value = run.id
        option.textContent = `${new Date(run.started).toLocaleTimeString()} · ${run.mode === 'elimination'
          ? '消灭'
          : '速度'} · ${run.kills} 杀 · ${run.reason === 'completed'
          ? '完成'
          : '中断'}`
        runSelect.append(option)
      }
      if (!choices?.length) {
        const option = document.createElement('option')
        option.textContent = '暂无已结束的挑战'
        runSelect.append(option)
      }
      setDisabled(runSelect, !choices?.length)
      setDisabled(exportButton, !choices?.length)
    }
    for (const button of choiceButtons) {
      const { difficulty, count, armorChoice } = button.dataset
      const selected = difficulty
        ? shooting && difficulty === settings.difficulty
        : count
          ? !shooting && Number(count) === settings.targetKills
          : Number(armorChoice) === settings.armor
      if (button.getAttribute('aria-pressed') !== String(selected))
        button.setAttribute('aria-pressed', String(selected))
    }
    setDisabled(selectionFields, running || !challenge)
    setDisabled(sensitivityFields, running)
    setDisabled(crosshair, running)
    setHidden(cancel, !running)
    setDisabled(cancel, cancelling)
    setText(ammoSetting, ammoText.textContent)
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
      setHidden(statusRow, !capacityError && !running && !completed)
      setHidden(progressRow, !running && !completed)
      setText(modeText, shooting
        ? difficultyLabels[settings.difficulty]
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
      setHidden(timeRow, shooting || (!running && !completed))
      setText(timeText, `${model?.timeLabel ?? '0'} 秒`)
      setText(armorText, settings.armor ? '已启用' : '已停用')
      const policy = model?.ammoPolicy ?? player.weapons?.readHud()?.weapon?.ammoPolicy
      setText(ammoText, policy === 'infinite-reserve'
        ? '已启用'
        : policy ? '关闭' : '—')
      setText(settingsLabel, running ? '查看本局' : '更改设置')
      if (model && card.dataset.revision !== String(model.revision))
        card.dataset.revision = String(model.revision)
    }
    if (modal.isOpen)
      updateModal()
  }
  owned.listen(settingsButton, 'click', modal.open)
  owned.listen(exportButton, 'click', () => {
    try {
      const file = challenge.playtests.exportCsv(runSelect.value, playerId.value.trim(), inputLayout)
      if (!file)
        return
      const view = document.defaultView
      const href = view.URL.createObjectURL(new Blob([file.csv], { type: 'text/csv;charset=utf-8' }))
      const link = document.createElement('a')
      link.href = href
      link.download = file.filename
      // Keep the download activation inside the open modal; the rest of the page is inert.
      dialog.append(link)
      try {
        link.click()
        setText(exportStatus, `已请求下载：${file.filename}`)
      }
      finally {
        link.remove()
        view.setTimeout(() => view.URL.revokeObjectURL(href), 1000)
      }
    }
    catch (error) {
      setText(exportStatus, `未能导出：${error.message}`)
    }
  })
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
  for (const button of choiceButtons) {
    owned.listen(button, 'click', () => {
      if (!challenge || challenge.running)
        return
      const { difficulty, count, armorChoice } = button.dataset
      const patch = difficulty
        ? { mode: 'shooting-test', difficulty }
        : count
          ? {
              mode: 'elimination',
              targetKills: Number(count),
            }
          : {
              armor: Number(armorChoice),
            }
      challenge.prepare({
        ...selection(),
        ...patch,
      })
      updateModal()
    })
  }
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
      if (!challenge?.running && stepSensitivity(player.lookSettings, Number(button.dataset.step)))
        sensitivity.removeAttribute('aria-invalid')
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
