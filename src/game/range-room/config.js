export const rangeRoomConfig = Object.freeze({
  manifestUrl: '/lighting/range-room-lightmap/manifest.json',
  textureAnisotropy: 16,
  atlasMaxMipLevel: 2,
  skyboxUrl: '/hdr/skybox-day.png',
  environmentIntensity: 0.35,
  probes: true,
  shadowPosition: Object.freeze([-3, 17.35, 3]),
  shadowTarget: Object.freeze([0.5, 9, 5.5]),
  trainingBot: Object.freeze({
    position: Object.freeze([0.567, 9, 7]),
    scale: 0.80,
  }),
})
