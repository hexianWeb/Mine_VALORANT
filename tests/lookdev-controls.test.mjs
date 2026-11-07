import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three/webgpu'
import { createColorGrading } from '../src/engine/systems/render/color-grading.js'
import { renderConfig, validateEffects } from '../src/engine/systems/render/config.js'
import { createRoomMaterial } from '../src/world/materials.js'
import { rangeRoomConfig } from '../src/world/range-room.js'
import { createRoomLights } from '../src/world/room-lights.js'
import { createEnvironmentProxy } from '../src/world/sky-environment.js'
import { buildAtlasMips, createTextureSampling } from '../src/world/texture-sampling.js'

test('Reinhard exposure 1.2 and 16x anisotropy are the requested defaults', () => {
  assert.equal(renderConfig.toneMapping, 'reinhard')
  assert.equal(renderConfig.toneMappingExposure, 1.2)
  assert.equal(rangeRoomConfig.textureAnisotropy, 16)
  assert.doesNotThrow(() => validateEffects(renderConfig))
  assert.throws(() => validateEffects({ ...renderConfig, aoRadius: Number.NaN }))
  assert.throws(() => validateEffects({ ...renderConfig, lutIntensity: 2 }))
})

test('sky lighting uses a bounded sRGB proxy without resizing the original background', () => {
  const image = { width: 4096, height: 2048 }
  let drawArguments
  const canvas = {
    getContext: () => ({
      drawImage: (...args) => {
        drawArguments = args
      },
    }),
  }
  const proxy = createEnvironmentProxy({ image }, canvas)
  assert.deepEqual([proxy.image.width, proxy.image.height], [1024, 512])
  assert.deepEqual([image.width, image.height], [4096, 2048])
  assert.equal(drawArguments[0], image)
  assert.equal(proxy.colorSpace, THREE.SRGBColorSpace)
  assert.equal(proxy.mapping, THREE.EquirectangularReflectionMapping)
  proxy.dispose()
})

test('unbaked voxel maps use nearest without mip interpolation and preserve source sRGB samplers', () => {
  const source = new THREE.Texture()
  source.colorSpace = THREE.SRGBColorSpace
  source.magFilter = THREE.LinearFilter
  const material = new THREE.MeshStandardMaterial({ map: source })
  const sampling = createTextureSampling()
  sampling.material(material)
  assert.notEqual(material.map, source)
  assert.equal(material.map.colorSpace, THREE.SRGBColorSpace)
  assert.equal(material.map.magFilter, THREE.NearestFilter)
  assert.equal(material.map.minFilter, THREE.NearestFilter)
  assert.equal(material.map.anisotropy, 1)
  assert.equal(material.map.generateMipmaps, false)
  assert.equal(material.map.mipmaps.length, 0)
  assert.equal(source.magFilter, THREE.LinearFilter)
  sampling.dispose()
  source.dispose()
  material.dispose()
})

test('limited atlas mipmaps preserve HDR and do not average transparent black into charts', () => {
  const half = THREE.DataUtils.toHalfFloat
  const pixels = [
    2,
    0.5,
    0.25,
    1,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
  ]
  const data = Uint16Array.from(pixels, half)
  const copy = data.slice()
  const levels = buildAtlasMips({ data, width: 2, height: 2 }, 2)
  assert.equal(levels.length, 2)
  assert.equal(THREE.DataUtils.fromHalfFloat(levels[1].data[0]), 2)
  assert.equal(THREE.DataUtils.fromHalfFloat(levels[1].data[3]), 0.25)
  assert.deepEqual(data, copy)
  const levels8 = buildAtlasMips({
    data: new Uint16Array(8 * 8 * 4),
    width: 8,
    height: 8,
  }, 2)
  assert.deepEqual(levels8.map(level => level.width), [8, 4, 2])
})

test('neutral 33³ half-float LUT is identity; warm preset and grading are real transforms', () => {
  const grading = createColorGrading()
  const index = ((16 * 33 + 16) * 33 + 16) * 4
  assert.equal(grading.texture.colorSpace, THREE.NoColorSpace)
  assert.equal(grading.texture.type, THREE.HalfFloatType)
  assert.equal(THREE.DataUtils.fromHalfFloat(grading.texture.image.data[index]), 0.5)
  grading.update({ preset: 'warm' })
  const red = THREE.DataUtils.fromHalfFloat(grading.texture.image.data[index])
  const blue = THREE.DataUtils.fromHalfFloat(grading.texture.image.data[index + 2])
  assert.ok(red > 0.5 && blue < 0.5)
  assert.throws(() => grading.update({ saturation: Number.NaN }))
  grading.reset()
  assert.equal(THREE.DataUtils.fromHalfFloat(grading.texture.image.data[index]), 0.5)
  grading.dispose()
})

test('cube imports validate size, data count and display domain without replacing a valid LUT on failure', () => {
  const grading = createColorGrading()
  const lines = []
  for (let b = 0; b < 2; b++) {
    for (let g = 0; g < 2; g++) {
      for (let r = 0; r < 2; r++)
        lines.push(`${r}E+0 ${g}E+0 ${b}E+0`)
    }
  }
  const cube = `TITLE "Identity test"\nLUT_3D_SIZE 2\n${lines.join('\n')}\n`
  grading.importCube(cube)
  assert.equal(grading.size, 2)
  assert.equal(grading.params.preset, 'custom')
  assert.equal(THREE.DataUtils.fromHalfFloat(grading.texture.image.data[28]), 1)
  const texture = grading.texture
  assert.throws(() => grading.importCube('LUT_3D_SIZE 2\n0 0 0'))
  assert.throws(() => grading.importCube(cube.replace('LUT_3D_SIZE 2', 'LUT_3D_SIZE 2\nDOMAIN_MAX 2 2 2')))
  assert.equal(grading.texture, texture)
  grading.dispose()
})

test('new corridor lights are localized and can explicitly illuminate baked receivers without old lights/AO', () => {
  const manifest = {
    lights: [],
    environment: {
      color: [1, 1, 1],
      intensity: 0.35,
    },
  }
  const lighting = createRoomLights(manifest, { corridorLighting: true, environmentLoaded: true })
  assert.equal(lighting.corridor.points.length, 3)
  assert.equal(lighting.root.children[0].intensity, 0)
  const source = new THREE.MeshStandardMaterial()
  const atlas = new THREE.Texture()
  const atlases = new Map()
  atlases.set('B01', atlas)
  const material = createRoomMaterial(source, {
    mode: 'baked-appearance',
    sourceMaterial: 'wall',
    atlasId: 'B01',
    uvChannel: 1,
  }, atlases, lighting.corridor)
  assert.equal(material.isMeshLambertNodeMaterial, true)
  assert.equal(material.lights, false)
  assert.ok(material.lightsNode && material.emissiveNode)
  assert.equal(material.userData.corridorLightOnly, true)
  lighting.setCorridorEnabled(false)
  assert.ok(lighting.corridor.points.every(light => light.intensity === 0))
  lighting.setCorridorEnabled(true)
  assert.ok(lighting.corridor.points.every(light => light.intensity === 55))
  lighting.dispose()
  material.dispose()
  source.dispose()
  atlas.dispose()
})
