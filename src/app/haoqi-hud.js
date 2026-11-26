import { haoqiRules } from '../game/range-room/challenges/haoqi-trial.js'

// The fixed-step trial owns lock order. Presentation only positions/reuses these markers.
export function mountHaoqiHud(layer) {
  const document = layer.ownerDocument
  const root = document.createElement('div')
  root.className = 'haoqi-hud'
  root.hidden = true
  root.innerHTML = `
    <div class="haoqi-status">
      <div class="haoqi-meter" hidden>
        <svg class="haoqi-flame" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" fill-rule="evenodd" d="M13 1c1 4-1.4 6.4-3 8.4C9.6 8.1 8.7 7.2 8 6.8c.4 3.7-4.2 5.7-4.2 10.2a8.2 8.2 0 0 0 16.4 0c0-3.7-2.1-6.6-4-8 .1 1.8-.6 2.8-1.6 3.4C16 7.6 15 3.8 13 1ZM12 21.4c-1.8 0-3-1.2-3-3 0-1.4 1.2-2.8 2.7-4-.1 1.1.3 1.7.8 2.1.4-.5.6-1.2.6-1.8 1.3 1.2 1.9 2.4 1.9 3.7 0 1.8-1.3 3-3 3Z"/>
        </svg>
        <strong class="haoqi-label">豪气值</strong>
        <span class="haoqi-value" aria-hidden="true"><b></b> / ${haoqiRules.cap}</span>
        <progress class="haoqi-charge" max="${haoqiRules.cap}" value="0" aria-label="豪气值"></progress>
      </div>
      <div class="haoqi-notice" hidden><strong></strong><span></span></div>
    </div>`
  const meter = root.querySelector('.haoqi-meter')
  const value = root.querySelector('.haoqi-value b')
  const bar = root.querySelector('progress')
  const notice = root.querySelector('.haoqi-notice')
  const title = notice.querySelector('strong')
  const detail = notice.querySelector('span')
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
    update(trial, result, empty, weapon) {
      root.hidden = !trial && !result
      if (root.hidden)
        return
      const flow = !!trial?.inFlow
      const canGuide = weapon === haoqiRules.weapon
      const locks = flow && canGuide
        ? trial.locks
        : []
      root.classList.toggle('is-flow', flow)
      meter.hidden = !trial
      if (trial) {
        const charge = trial.charge
        const displayed = Math.floor(charge)
        text(value, String(displayed))
        if (bar.value !== charge) {
          bar.value = charge
          bar.setAttribute('aria-valuetext', `${displayed} / ${haoqiRules.cap}`)
        }
      }

      notice.hidden = !(flow || result || empty)
      if (flow) {
        text(title, `心流 · 神经枪  ${trial.remaining.toFixed(1)} s`)
        const prompt = !canGuide
          ? '切回狂徒可重新确认锁定'
          : empty
            ? '按换弹键补弹'
            : trial.confirmed
              ? '保持开火 · 按序锁定'
              : locks.length ? '重新按住开火 · 确认锁定' : '转向视野内的目标'
        text(detail, prompt)
      }
      else if (result) {
        text(title, '豪气试炼 · 结算')
        text(detail, `手动 ${result.outside_kills} 杀 / 心流 ${result.flow_kills} 杀 · 靶场设置导出 CSV`)
      }
      else if (empty) {
        text(title, '')
        text(detail, '请换弹')
      }
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
