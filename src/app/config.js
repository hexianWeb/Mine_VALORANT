import { inputBindings } from '../configs/input-bindings.js'
import { renderConfig } from '../engine/runtime/function/render/index.js'

export function readAppConfig(search = globalThis.location.search) {
  const parameters = new URLSearchParams(search)
  return {
    inputBindings,
    render: {
      ...renderConfig,
      trackTimestamp: parameters.get('profile') === '1',
      ...(parameters.get('ao') === '0'
        ? { ao: false }
        : {}),
      ...(parameters.get('aa') === 'none'
        ? { aa: 'none' }
        : {}),
    },
    level: {
      probes: parameters.get('probes') !== '0',
      reflectionPreview: parameters.get('reflectionPreview') === '1',
      ...(parameters.get('lighting') === 'appearance'
        ? { manifestUrl: '/lighting/range-room/manifest.json' }
        : {}),
    },
    editor: parameters.get('editor') !== '0',
    startMode: parameters.get('player') === '0'
      ? 'fly'
      : 'player',
  }
}
