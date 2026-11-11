// 渲染器与后处理的默认值，与场景内容无关。
export const renderConfig = Object.freeze({
  maxPixelRatio: 1,
  toneMapping: 'reinhard',
  toneMappingExposure: 1.11,
  ao: true,
  aoResolutionScale: 0.5,
  aoRadius: 3,
  aoThickness: 3,
  aoStrength: 2.22,
  aoSamples: 16,
  denoise: true,
  denoiseResolutionScale: null, // null 跟随 GTAO；显式比例会覆盖它。
  aoView: 'scene',
  denoiseRadius: 5,
  lutEnabled: true,
  lutIntensity: 1,
  aa: 'smaa',
  trackTimestamp: false, // 用 ?profile=1 开启，或在创建性能分析实例时开启。
  viewmodelLightIntensity: 3, // 独立视模光照，不复用世界 AO 或房间灯光。
})

export function validateEffects(config) {
  for (const key of ['ao', 'denoise', 'lutEnabled']) {
    if (typeof config[key] !== 'boolean')
      throw new TypeError(`Invalid ${key}: expected a boolean`)
  }
  if (config.denoiseResolutionScale !== null && (!Number.isFinite(config.denoiseResolutionScale) || config.denoiseResolutionScale < 0.25 || config.denoiseResolutionScale > 1))
    throw new Error('Invalid denoiseResolutionScale: expected null or 0.25–1')
  const ranges = {
    toneMappingExposure: [0.01, 16],
    aoRadius: [0.01, 10],
    aoThickness: [0.01, 10],
    aoStrength: [0, 5],
    aoResolutionScale: [0.25, 1],
    denoiseRadius: [1, 16],
    lutIntensity: [0, 1],
    viewmodelLightIntensity: [0, 32],
  }
  for (const [key, [min, max]] of Object.entries(ranges)) {
    if (!Number.isFinite(config[key]) || config[key] < min || config[key] > max)
      throw new Error(`Invalid ${key}: expected ${min}–${max}`)
  }
  if (!['scene', 'ao'].includes(config.aoView) || !['smaa', 'none'].includes(config.aa))
    throw new Error('Invalid AO view or anti-aliasing mode')
  if (!Number.isInteger(config.aoSamples) || config.aoSamples < 4 || config.aoSamples > 64)
    throw new Error('AO samples must be an integer between 4 and 64')
}
