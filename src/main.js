import { createApplication } from './app/bootstrap.js'
import './app/style.css'

const status = document.querySelector('.loading')
const unsupported = document.querySelector('.unsupported')
let cancelled = false
function showError(error) {
  status.hidden = true
  unsupported.hidden = false
  unsupported.textContent = `练枪房加载失败：${error?.message ?? error}`
  console.error('[Range room]', error)
}
const app = createApplication({
  canvas: document.querySelector('.webgl'),
  status,
  panelContainer: document.querySelector('.debug-panel'),
  onError: showError,
})
app.initialize().catch((error) => {
  if (!cancelled)
    showError(error)
})

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    cancelled = true
    app.dispose()
  })
}
