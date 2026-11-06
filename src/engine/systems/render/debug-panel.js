import { Pane } from 'tweakpane'
import { gradingPresets } from './color-grading.js'
import { renderConfig } from './config.js'

/** User-requested AO and LUT controls. No mutation of source assets or Blender state. */
export function createDebugPanel(render, container) {
  const state = render.getDebugState()
  const params = {
    ...state,
    ...state.grading,
    lutFile: state.customLutTitle || '内置 LUT',
  }
  const pane = new Pane({ container, title: '渲染调试 · Reinhard' })
  const message = document.createElement('p')
  message.className = 'debug-message'
  message.textContent = 'LUT：显示 sRGB 域 · Tone mapping 后 / SMAA 前'
  container.append(message)
  const file = document.createElement('input')
  file.type = 'file'
  file.accept = '.cube'
  file.hidden = true
  container.append(file)
  let disposed = false
  const sync = () => {
    const current = render.getDebugState()
    Object.assign(params, current, current.grading, { lutFile: current.customLutTitle || '内置 LUT' })
    pane.refresh()
  }
  const safely = (action) => {
    try {
      action()
      message.textContent = 'LUT：显示 sRGB 域 · Tone mapping 后 / SMAA 前'
    }
    catch (error) {
      message.textContent = error.message
    }
    sync()
  }
  const ao = pane.addFolder({ title: 'AO · 接触遮蔽', expanded: true })
  const bindEffect = (folder, key, options) => folder.addBinding(params, key, options)
    .on('change', event => safely(() => render.setEffects({ [key]: event.value })))
  bindEffect(ao, 'ao', { label: '启用 AO' })
  bindEffect(ao, 'aoView', {
    label: '显示',
    options: { 完整画面: 'scene', 仅AO: 'ao' },
  })
  bindEffect(ao, 'aoStrength', {
    label: '强度',
    min: 0,
    max: 3,
    step: 0.01,
  })
  bindEffect(ao, 'aoRadius', {
    label: '半径 / m',
    min: 0.05,
    max: 3,
    step: 0.01,
  })
  bindEffect(ao, 'aoThickness', {
    label: '厚度 / m',
    min: 0.05,
    max: 3,
    step: 0.01,
  })
  bindEffect(ao, 'aoSamples', {
    label: '采样',
    options: { 8: 8, 16: 16, 32: 32, 64: 64 },
  })
  bindEffect(ao, 'aoResolutionScale', {
    label: '分辨率',
    options: { '全分辨率': 1, '75%': 0.75, '50%': 0.5 },
  })
  bindEffect(ao, 'denoise', { label: '去噪' })
  bindEffect(ao, 'denoiseRadius', {
    label: '去噪半径',
    min: 1,
    max: 10,
    step: 1,
  })
  ao.addButton({ title: '重置 AO' }).on('click', () => safely(() => render.setEffects({
    ao: true,
    aoView: 'scene',
    aoRadius: renderConfig.aoRadius,
    aoThickness: renderConfig.aoThickness,
    aoStrength: renderConfig.aoStrength,
    aoSamples: renderConfig.aoSamples,
    aoResolutionScale: renderConfig.aoResolutionScale,
    denoise: true,
    denoiseRadius: renderConfig.denoiseRadius,
  })))

  const lut = pane.addFolder({ title: 'LUT · Color grading', expanded: true })
  bindEffect(lut, 'toneMappingExposure', {
    label: '曝光强度',
    min: 0.1,
    max: 3,
    step: 0.01,
  })
  bindEffect(lut, 'lutEnabled', { label: '启用 LUT' })
  bindEffect(lut, 'lutIntensity', {
    label: '混合强度',
    min: 0,
    max: 1,
    step: 0.01,
  })
  const bindGrading = (key, options) => lut.addBinding(params, key, options)
    .on('change', event => safely(() => render.setColorGrading({ [key]: event.value })))
  bindGrading('preset', { label: '预设', options: gradingPresets })
  bindGrading('contrast', {
    label: '对比度',
    min: 0.5,
    max: 1.5,
    step: 0.01,
  })
  bindGrading('saturation', {
    label: '饱和度',
    min: 0,
    max: 2,
    step: 0.01,
  })
  bindGrading('temperature', {
    label: '冷 / 暖',
    min: -1,
    max: 1,
    step: 0.01,
  })
  bindGrading('tint', {
    label: '绿 / 洋红',
    min: -1,
    max: 1,
    step: 0.01,
  })
  lut.addBinding(params, 'lutFile', { label: '已导入', readonly: true })
  lut.addButton({ title: '导入 .cube LUT' }).on('click', () => file.click())
  lut.addButton({ title: '重置调色' }).on('click', () => safely(() => {
    render.resetColorGrading()
    render.setEffects({ lutEnabled: true, lutIntensity: 1, toneMappingExposure: 1.2 })
  }))
  const onFile = async () => {
    const selected = file.files[0]
    if (!selected)
      return
    try {
      if (selected.size > 10 * 1024 * 1024)
        throw new Error('LUT 文件不能超过 10 MiB')
      const text = await selected.text()
      if (disposed)
        return
      safely(() => render.importLut(text, selected.name))
    }
    catch (error) {
      message.textContent = error.message
    }
    finally {
      file.value = ''
    }
  }
  file.addEventListener('change', onFile)
  return {
    pane,
    params,
    refresh: sync,
    dispose() {
      disposed = true
      file.removeEventListener('change', onFile)
      pane.dispose()
      file.remove()
      message.remove()
    },
  }
}
