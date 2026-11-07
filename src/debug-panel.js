import { Pane } from 'tweakpane'
import { gradingPresets } from './engine/systems/render/color-grading.js'
import { renderConfig } from './engine/systems/render/config.js'

/** User-requested AO and LUT controls. No mutation of source assets or Blender state. */
export function createDebugPanel(render, container, lightingMode = 'lightmap') {
  const state = render.getDebugState()
  const params = {
    ...state,
    ...state.grading,
    denoiseResolutionScale: state.denoiseResolutionScale ?? 0,
    lutFile: state.customLutTitle || '内置 LUT',
  }
  const pane = new Pane({ container, title: '渲染调试 · Reinhard' })
  const lighting = document.createElement('p')
  lighting.className = 'debug-lighting'
  const alternate = new URL(location.href)
  const isLightmap = lightingMode === 'lightmap'
  alternate.searchParams.set('lighting', isLightmap ? 'appearance' : 'lightmap')
  const label = isLightmap ? 'Lightmap · AO 可作用墙地面' : '原版 · 完整烘焙外观'
  lighting.append(`${label} · `)
  const switchLink = document.createElement('a')
  switchLink.href = alternate.href
  switchLink.textContent = isLightmap ? '切回原版' : '切换 Lightmap'
  lighting.append(switchLink)
  container.prepend(lighting)
  const message = document.createElement('p')
  message.className = 'debug-message'
  message.textContent = 'AO：低分辨率 + 边缘重建 · LUT：线性 SMAA 后的 sRGB 域'
  container.append(message)
  const file = document.createElement('input')
  file.type = 'file'
  file.accept = '.cube'
  file.hidden = true
  container.append(file)
  let disposed = false
  const sync = () => {
    const current = render.getDebugState()
    Object.assign(params, current, current.grading, { lutFile: current.customLutTitle || '内置 LUT', denoiseResolutionScale: current.denoiseResolutionScale ?? 0 })
    pane.refresh()
  }
  const safely = (action) => {
    try {
      action()
      message.textContent = 'AO：低分辨率 + 边缘重建 · LUT：线性 SMAA 后的 sRGB 域'
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
  ao.addBinding(params, 'denoiseResolutionScale', {
    label: '去噪分辨率',
    options: {
      '跟随AO': 0,
      '全分辨率': 1,
      '75%': 0.75,
      '50%': 0.5,
    },
  }).on('change', event => safely(() => render.setEffects({ denoiseResolutionScale: event.value || null })))
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
    denoiseResolutionScale: renderConfig.denoiseResolutionScale,
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
    render.setEffects({ lutEnabled: true, lutIntensity: 1, toneMappingExposure: renderConfig.toneMappingExposure })
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
      lighting.remove()
    },
  }
}
