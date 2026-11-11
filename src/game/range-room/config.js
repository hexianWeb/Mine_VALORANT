export const rangeRoomConfig = Object.freeze({
  manifestUrl: '/lighting/range-room-lightmap/manifest.json',
  textureAnisotropy: 16,
  atlasMaxMipLevel: 2,
  skyboxUrl: '/hdr/skybox-day.png',
  environmentIntensity: 0.35,
  probes: true,
  center: Object.freeze([0.5, 11.8, 5.5]),
  orbitRadius: Object.freeze([6.5, 4.5]),
  shadowPosition: Object.freeze([-3, 17.35, 3]),
  shadowTarget: Object.freeze([0.5, 9, 5.5]),
})
