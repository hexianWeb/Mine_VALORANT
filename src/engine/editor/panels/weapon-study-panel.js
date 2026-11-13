/** App injects the optional game-side study API; editor has no game imports. */
export function addWeaponStudyPanel(pane, study) {
  const state = study.getDebugState()
  const params = {
    enabled: state.enabled,
    roughness: state.roughness,
    flatShading: state.flatShading,
    source: state.source,
    intensity: state.intensity,
  }
  const folder = pane.addFolder({ title: 'Classic AG · 金属小样', expanded: true })
  const status = document.createElement('p')
  status.className = 'probe-status'
  folder.element.append(status)
  const sync = (current = study.getDebugState()) => {
    for (const key of Object.keys(params)) params[key] = current[key]
    status.textContent = current.reflection.ready
      ? '静态室内 HDR · 金属 1／自发光 0.4／清漆沿用资源 · 仅 Classic v4 AG\n倍率只调室内反射，不改变天空回退。尚无盒投影和走廊混合。'
      : `室内反射未就绪，使用天空回退：${current.reflection.error ?? ''}`
    pane.refresh()
  }
  const bind = (key, options) => folder.addBinding(params, key, options).on('change', (event) => {
    try {
      study.setLighting({ [key]: event.value })
    }
    catch (error) {
      status.textContent = error.message
    }
  })
  bind('enabled', { label: '启用小样' })
  bind('flatShading', { label: '平直着色' })
  bind('roughness', {
    label: '粗糙度',
    min: 0.08,
    max: 1,
    step: 0.01,
  })
  bind('source', {
    label: '镜面环境',
    options: { 室内: 'indoor', 天空: 'sky', 关闭: 'off' },
  })
  bind('intensity', {
    label: '室内反射倍率',
    min: 0,
    max: 2,
    step: 0.01,
  })
  const off = study.subscribe(sync)
  sync()
  return {
    dispose() {
      off()
      status.remove()
      folder.dispose()
    },
  }
}
