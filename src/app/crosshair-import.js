import { parseCrosshairCode } from './crosshair-code.js'
import { createCrosshairRenderer } from './crosshair-renderer.js'

function previewScale(style, width, height) {
  const sizes = [style.dot?.size ?? 0]
  for (const line of [style.inner, style.outer]) {
    if (line)
      sizes.push(2 * (line.offset + Math.max(line.length, line.verticalLength)) + line.thickness)
  }
  const outline = style.outline?.thickness ?? 0
  const extent = Math.max(1, ...sizes) + 2 * outline
  return Math.min(3, (Math.min(width, height) - 12) / extent)
}

/** Keeps the draft local until the player applies it. */
export function mountCrosshairImport({ root, ui, getProfile, onApply }) {
  const document = root.ownerDocument
  const open = document.createElement('button')
  open.type = 'button'
  open.className = 'crosshair-open'
  open.setAttribute('aria-haspopup', 'dialog')
  open.textContent = '准星'

  const dialog = document.createElement('dialog')
  dialog.className = 'crosshair-dialog'
  dialog.setAttribute('aria-labelledby', 'crosshair-import-title')
  dialog.innerHTML = `
    <form>
      <h2 id="crosshair-import-title">准星代码导入</h2>
      <label for="crosshair-code">VALORANT 准星代码</label>
      <textarea id="crosshair-code" rows="3" spellcheck="false" autocomplete="off" autofocus
        placeholder="粘贴准星代码，自动预览" aria-describedby="crosshair-status"></textarea>
      <div class="crosshair-preview-heading">
        <label for="crosshair-preview-mode">预览</label>
        <select id="crosshair-preview-mode">
          <option value="primary">主准星</option>
          <option value="ads">开镜</option>
          <option value="sniper">狙击镜</option>
        </select>
      </div>
      <canvas class="crosshair-preview" role="img" aria-label="准星预览"></canvas>
      <p id="crosshair-status" class="crosshair-status" role="status"></p>
      <div class="crosshair-actions">
        <button type="button" data-crosshair-close>关闭</button>
        <button type="submit" disabled>应用到 HUD</button>
      </div>
    </form>
  `
  root.append(open)
  const form = dialog.querySelector('form')
  const code = dialog.querySelector('textarea')
  const mode = dialog.querySelector('select')
  const preview = dialog.querySelector('canvas')
  const status = dialog.querySelector('[role="status"]')
  const apply = dialog.querySelector('button[type="submit"]')
  const draw = createCrosshairRenderer(preview)
  let draft = null
  let parsed = getProfile()

  const showPreview = () => {
    if (!dialog.open)
      return
    const ratio = document.defaultView.devicePixelRatio
    const { clientWidth: width, clientHeight: height } = preview
    preview.width = Math.round(width * ratio)
    preview.height = Math.round(height * ratio)
    const style = parsed?.[mode.value]
    draw(style, style
      ? ratio * previewScale(style, width, height)
      : ratio)
  }
  const readDraft = () => {
    draft = null
    parsed = getProfile()
    status.textContent = ''
    delete status.dataset.error
    code.removeAttribute('aria-invalid')
    if (code.value.trim()) {
      try {
        draft = parseCrosshairCode(code.value)
        parsed = draft
        if (draft.extraFields.length)
          status.textContent = `以下扩展字段需要单独支持 ${draft.extraFields.join('、')}`
      }
      catch (error) {
        parsed = null
        status.textContent = error.message
        status.dataset.error = ''
        code.setAttribute('aria-invalid', 'true')
      }
    }
    apply.disabled = !draft
    showPreview()
  }
  const modal = ui.registerModal('crosshair', dialog, {
    onOpen() {
      code.value = getProfile().code
      mode.value = 'primary'
      readDraft()
    },
  })
  let enabled = true
  const syncLock = () => {
    open.hidden = !enabled || !!document.pointerLockElement
  }
  const openDialog = () => modal.open()
  const closeDialog = () => modal.close()
  open.addEventListener('click', openDialog)
  dialog.querySelector('[data-crosshair-close]').addEventListener('click', closeDialog)
  code.addEventListener('input', readDraft)
  mode.addEventListener('change', showPreview)
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    if (draft) {
      onApply(draft)
      modal.close()
    }
  })
  document.addEventListener('pointerlockchange', syncLock)
  document.defaultView.addEventListener('resize', showPreview)
  syncLock()
  return {
    open: openDialog,
    setEnabled(value) {
      if (enabled === value)
        return
      enabled = value
      syncLock()
      if (!value)
        modal.close('owner')
    },
    dispose() {
      modal.dispose()
      open.removeEventListener('click', openDialog)
      open.remove()
      document.removeEventListener('pointerlockchange', syncLock)
      document.defaultView.removeEventListener('resize', showPreview)
    },
  }
}
