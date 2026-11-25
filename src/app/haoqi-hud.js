import { haoqiRules } from '../game/range-room/challenges/haoqi-trial.js'

// The fixed-step trial owns lock order. Presentation only positions/reuses these markers.
export function mountHaoqiHud(layer) {
  const document = layer.ownerDocument
  const root = document.createElement('div')
  root.className = 'haoqi-hud'
  root.hidden = true
  root.innerHTML = `<div class="haoqi-strip"><strong></strong><progress max="${haoqiRules.cap}" aria-label="豪气"></progress><span></span></div>`
  const title = root.querySelector('strong')
  const detail = root.querySelector('span')
  const bar = root.querySelector('progress')
  const markers = Array.from({ length: 5 }, (_, i) => {
    const mark = document.createElement('b')
    mark.className = 'haoqi-lock'
    mark.textContent = String(i + 1)
    root.append(mark)
    return mark
  })
  layer.append(root)
  const text = (node, s) => {
    if (node.textContent !== s)
      node.textContent = s
  }
  return {
    dispose: () => root.remove(),
    update(trial, result, empty) {
      root.hidden = !trial && !result
      if (root.hidden)
        return
      const flow = !!trial?.inFlow
      const locks = flow
        ? trial.locks
        : []
      root.classList.toggle('is-flow', flow)
      text(title, trial
        ? flow
          ? `心流 · 神经枪  ${trial.remaining.toFixed(1)} s`
          : '豪气试炼 · 手射'
        : '豪气试炼 · 结算')
      bar.hidden = !trial
      if (trial)
        bar.value = trial.charge
      const prompt = empty
        ? '按换弹键补弹'
        : trial?.confirmed
          ? '保持开火 · 按序锁定'
          : locks.length ? '重新按住开火 · 确认锁定' : '转向视野内的目标'
      text(detail, trial
        ? flow
          ? prompt
          : `${Math.floor(trial.charge)} / ${haoqiRules.cap} 豪气 ×${(trial.multiplier / 100).toFixed(2)}${empty ? ' · 请换弹' : ''}`
        : `手射 ${result.outside_kills} 杀 / 心流 ${result.flow_kills} 杀 · ~ 导出 CSV`)
      for (const [i, marker] of markers.entries()) {
        const lock = locks[i]
        marker.hidden = !lock
        if (lock) {
          marker.style.left = `${lock.x * 100}%`
          marker.style.top = `${lock.y * 100}%`
        }
      }
    },
  }
}
