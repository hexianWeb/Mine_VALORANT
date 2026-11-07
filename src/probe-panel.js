/** Live lighting ratios and explicit static-capture settings have separate lifecycles. */
export function addProbePanel(pane, probes) {
  const state = probes.getDebugState()
  const params = { ...state }
  const captureParams = { ...state.capture }
  const volumeParams = Object.fromEntries(state.volumes.map(volume => [volume.id, volume.intensity]))
  const folder = pane.addFolder({ title: 'LightProbe · 室内间接光', expanded: true })
  const status = document.createElement('p')
  status.className = 'probe-status'
  let disposed = false
  const safely = (action) => {
    try {
      action()
    }
    catch (error) {
      status.textContent = error.message
    }
  }
  const bind = (key, options) => folder.addBinding(params, key, options)
    .on('change', event => safely(() => probes.setLighting({ [key]: event.value })))
  const slider = label => ({
    label,
    min: 0,
    max: 4,
    step: 0.01,
  })
  bind('enabled', { label: '启用探针' })
  bind('intensity', slider('探针总强度'))
  const labels = { LPV_Room: '室内强度', LPV_Corridor_01: '走廊 01 强度', LPV_Corridor_02: '走廊 02 强度' }
  for (const volume of state.volumes) {
    folder.addBinding(volumeParams, volume.id, slider(labels[volume.id] ?? volume.id))
      .on('change', event => safely(() => probes.setVolumeIntensity(volume.id, event.value)))
  }
  bind('skyDiffuse', slider('天空漫反射'))
  bind('skySpecular', slider('天空镜面反射'))
  bind('direct', slider('实时顶灯倍率'))
  bind('showBounds', { label: '显示体积边界' })
  bind('showProbes', { label: '显示探针球' })
  const capture = folder.addFolder({ title: '捕获 · 修改后重新烘焙', expanded: false })
  const bindCapture = (key, options) => capture.addBinding(captureParams, key, options)
    .on('change', event => safely(() => probes.setCapture({ [key]: event.value })))
  bindCapture('sky', slider('捕获天空贡献'))
  bindCapture('emissive', slider('捕获灯带自发光'))
  bindCapture('direct', slider('捕获顶灯倍率'))
  bindCapture('cubemapSize', {
    label: '每面分辨率',
    options: {
      '8²': 8,
      '16²': 16,
      '32²': 32,
      '64²': 64,
    },
  })
  const bake = folder.addButton({ title: '重新捕获探针' })
  bake.element.before(status)
  bake.on('click', async () => {
    try {
      await probes.rebake()
    }
    catch (error) {
      if (!disposed)
        status.textContent = `捕获失败：${error.message}`
    }
  })
  const reset = folder.addButton({ title: '重置探针调光' })
  reset.on('click', () => safely(() => probes.reset()))
  const sync = (current = probes.getDebugState()) => {
    Object.assign(params, current)
    Object.assign(captureParams, current.capture)
    for (const volume of current.volumes)
      volumeParams[volume.id] = volume.intensity
    capture.disabled = bake.disabled = reset.disabled = current.busy
    if (current.error) {
      status.textContent = `捕获失败：${current.error}`
    }
    else if (current.busy) {
      status.textContent = `捕获中 ${Math.round(current.progress * 100)}% · 完成后统一应用`
    }
    else {
      const origin = current.source === 'precomputed'
        ? '预计算'
        : '本次捕获'
      const readiness = current.dirty ? '参数已变更，待重新捕获' : '数据就绪'
      status.textContent = `${origin} · ${current.total} 个探针 · ${readiness}\n天空滑杆为原环境的倍率；捕获不包含茶壶、辅助阴影灯和后处理。`
    }
    pane.refresh()
  }
  const off = probes.subscribe(sync)
  sync()
  return {
    refresh: sync,
    dispose() {
      disposed = true
      off()
      folder.dispose()
      status.remove()
    },
  }
}
