// Defaults; AO and color grading can now be edited in the explicitly requested debug panel.
export const renderConfig = Object.freeze({
  manifestUrl: '/lighting/range-room/manifest.json',
  maxPixelRatio: 1,
  toneMapping: 'reinhard',
  toneMappingExposure: 1.2,
  textureAnisotropy: 16,
  atlasMaxMipLevel: 2,
  skyboxUrl: '/hdr/skybox-day.png',
  environmentIntensity: 0.35,
  corridorLighting: true,
  ao: true,
  aoResolutionScale: 1,
  aoRadius: 0.5,
  aoThickness: 0.5,
  aoStrength: 1,
  aoSamples: 16,
  denoise: true,
  aoView: 'scene',
  denoiseRadius: 5,
  lutEnabled: true,
  lutIntensity: 1,
  aa: 'smaa',
  trackTimestamp: true,
})

export function validateEffects(config) {
  const ranges = {
    toneMappingExposure: [0.01, 16],
    aoRadius: [0.01, 10],
    aoThickness: [0.01, 10],
    aoStrength: [0, 5],
    aoResolutionScale: [0.25, 1],
    denoiseRadius: [1, 16],
    lutIntensity: [0, 1],
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
