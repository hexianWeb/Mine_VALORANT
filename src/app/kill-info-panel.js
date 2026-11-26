import { Disposer } from '../engine/runtime/core/disposer.js'
import { weaponIcons } from './weapon-icons.js'

const skull = `<svg class="kill-skull" viewBox="0 0 20 16" aria-hidden="true" shape-rendering="crispEdges">
  <path fill="currentColor" fill-rule="evenodd" d="M4 1h12v2h2v3h2v7h-3v-3h-2v5h-3v-2H8v2H5v-5H3v3H0V6h2V3h2zm0 5v3h5V6zm7 0v3h5V6z"/>
</svg>`

const titles = ['击杀', '双杀', '三连杀', '四连杀', '五连杀']
const bonusLabels = {
  defeat: '击败',
  combo: '连续击败',
  headshot: '爆头击杀',
  ruthless: '无情',
}
const fadeDuration = 0.22

function feedRow(document, entry) {
  const row = document.createElement('li')
  row.toggleAttribute('data-headshot', entry.headshot)
  row.innerHTML = `<span>你</span><span class="kill-feed-weapon"></span>${skull}<span>BOT</span><strong hidden>爆头</strong>`
  const weapon = row.querySelector('.kill-feed-weapon')
  const id = entry.definitionId
  if (Object.hasOwn(weaponIcons, id)) {
    const image = document.createElement('img')
    image.src = weaponIcons[id]
    image.alt = id.toUpperCase()
    weapon.append(image)
  }
  else {
    weapon.textContent = id === 'karambit'
      ? '爪刀'
      : id?.toUpperCase() ?? '近战'
  }
  row.querySelector('strong').hidden = !entry.headshot
  return row
}

export function mountKillInfoPanel({ ui, engine, controls, readFeedback }) {
  const document = ui.root.ownerDocument
  const owned = new Disposer()
  const panel = document.createElement('section')
  panel.className = 'kill-info-panel'
  panel.setAttribute('aria-label', '击杀反馈')
  panel.hidden = true
  panel.innerHTML = `
    <div class="kill-info-header" role="status">
      <div class="kill-info-medal" aria-hidden="true">
        <svg class="kill-info-burst" viewBox="0 0 100 100">
          <circle class="kill-info-wave" cx="50" cy="51" r="39"/>
          <circle class="kill-info-wave kill-info-wave-echo" cx="50" cy="51" r="39"/>
          <path class="kill-info-rays" d="M10 37l9 3 M82 62l8 3 M18 77l7-6 M74 31l7-6 M40 12l2 9 M58 81l2 9"/>
          <path class="kill-info-rays kill-info-rays-extra" d="M9 54l8-1 M83 47l9-1 M22 18l7 7 M71 77l7 7 M50 7v8 M50 87v8"/>
        </svg>
        <svg class="kill-info-ring" viewBox="0 0 100 100">
          <circle class="kill-info-disc" cx="50" cy="51" r="38"/>
          <circle class="kill-info-trim" cx="50" cy="51" r="34.5"/>
          <path fill="#f7ebc8" d="M47 89h6l-3 9z"/>
          <circle class="kill-info-sweep" cx="50" cy="51" r="38" pathLength="100"/>
          <g class="kill-info-markers"></g>
        </svg>
        ${skull}
      </div>
      <div class="kill-info-readout">
        <strong class="kill-info-points"></strong>
        <span class="kill-info-title"></span>
      </div>
    </div>
    <div class="kill-info-bonuses"></div>`
  const markers = panel.querySelector('.kill-info-markers')
  const title = panel.querySelector('.kill-info-title')
  const points = panel.querySelector('.kill-info-points')
  const bonuses = panel.querySelector('.kill-info-bonuses')
  const feed = document.createElement('ol')
  feed.className = 'kill-feed'
  feed.setAttribute('aria-label', '最近击杀')
  feed.hidden = true
  ui.hud.append(panel, feed)
  owned.add(() => {
    panel.remove()
    feed.remove()
  })

  let gameplay = controls.read().mode === 'gameplay'
  let lastPanel = null
  let lastFeed
  let feedRows = []
  const update = () => {
    const state = readFeedback()
    panel.hidden = !gameplay || !state?.panel
    feed.hidden = !gameplay || !state?.feed.length
    if (!state)
      return

    const current = state.panel
    if (current && current !== lastPanel) {
      lastPanel = current
      panel.toggleAttribute('data-headshot', current.markers.at(-1))
      panel.dataset.streak = Math.min(current.count, titles.length)
      const latest = current.markers.length - 1
      markers.innerHTML = current.markers.map((headshot, index) => {
        const angle = (index - latest / 2) * 23
        const latestAttribute = index === latest
          ? 'data-latest'
          : ''
        return `<g transform="rotate(${angle} 50 51)">
          <path ${headshot ? 'data-headshot' : ''} ${latestAttribute} d="M44.5 1h11L55 12H45z"/>
        </g>`
      }).join('')
      title.textContent = titles[current.count - 1] ?? `${current.count} 连杀`
      points.textContent = `+${current.points}`
      bonuses.replaceChildren(...current.bonuses.map(({ kind, points }) => {
        const chip = document.createElement('span')
        chip.textContent = `${bonusLabels[kind]} +${points}`
        chip.toggleAttribute('data-headshot', kind === 'headshot')
        return chip
      }))
    }
    if (!panel.hidden) {
      panel.style.setProperty('--kill-age', `${state.at - current.at}s`)
      panel.style.setProperty('--kill-fade', Math.min(1, (current.expiresAt - state.at) / fadeDuration))
    }

    if (state.feed !== lastFeed) {
      lastFeed = state.feed
      feedRows = state.feed.map(entry => feedRow(document, entry))
      feed.replaceChildren(...feedRows)
    }
    if (!feed.hidden) {
      feedRows.forEach((row, index) => {
        row.style.opacity = Math.min(1, (state.feed[index].expiresAt - state.at) / fadeDuration)
      })
    }
  }
  owned.add(engine.events.on('frame', update))
  owned.add(controls.subscribe((state) => {
    gameplay = state.mode === 'gameplay'
    update()
  }))
  update()
  return owned
}
