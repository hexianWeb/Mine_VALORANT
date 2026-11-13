import * as THREE from 'three/webgpu'
import { ResourceManager } from '../src/engine/runtime/resource/resource-manager.js'
import { WeaponAssets } from '../src/game/weapons/assets/weapon-assets.js'

function check(value, message) {
  if (!value)
    throw new Error(message)
}

function emissionMap(color) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1
  const context = canvas.getContext('2d')
  context.fillStyle = color
  context.fillRect(0, 0, 1, 1)
  return {
    url: canvas.toDataURL('image/png'),
    colorSpace: 'srgb',
    flipY: false,
    magFilter: 'nearest',
    minFilter: 'nearest',
    generateMipmaps: false,
  }
}

/** Real GLB, texture decoding and WebGPU HDR pixels; fixture JSON stays in this test's manager. */
export async function checkWeaponSkinEmission(app) {
  const { render, scene } = app
  const layer = render.viewmodel
  const manifestURL = new URL('/weapons/classic/v4/manifest.json', location.href)
  const manifest = await (await fetch(manifestURL)).json()
  const skinURL = new URL(manifest.skins[manifest.defaultSkinId].url, manifestURL)
  const skin = await (await fetch(skinURL)).json()
  const albedo = { ...skin.materials.weapon.map, url: new URL(skin.materials.weapon.map.url, skinURL).href }
  manifest.model.url = new URL(manifest.model.url, manifestURL).href
  manifest.defaultSkinId = 'plain'
  manifest.skins = Object.fromEntries(['plain', 'red', 'green'].map(id => [
    id,
    { url: `skins/${id}.json` },
  ]))
  const fixtureURL = new URL('/__weapon-emission-test__/classic/v4/manifest.json', location.href)
  const documents = new Map([
    [fixtureURL.href, manifest],
  ])
  for (const [id, emission, intensity] of [
    ['plain', null, 1],
    [
      'red',
      emissionMap('#ff0000'),
      2,
    ],
    [
      'green',
      emissionMap('#008000'),
      4,
    ],
  ]) {
    documents.set(new URL(`skins/${id}.json`, fixtureURL).href, {
      ...skin,
      skinId: id,
      materials: {
        weapon: {
          map: albedo,
          ...(emission
            ? { emissiveMap: emission, emissiveIntensity: intensity }
            : {}),
        },
      },
    })
  }
  const resources = new ResourceManager()
  const load = resources.load.bind(resources)
  resources.load = (entries, options) => load(entries.map(entry => documents.has(entry.url)
    ? { ...entry, url: `data:application/json,${encodeURIComponent(JSON.stringify(documents.get(entry.url)))}` }
    : entry), options)
  const assets = new WeaponAssets({ resources, scopeId: 'browser-emission-test', baseUrl: new URL('../..', fixtureURL).href })
  const visibility = layer.scene.children.map(object => [object, object.visible])
  const lights = []
  for (const root of [scene, layer.scene]) {
    root.traverse((object) => {
      if (object.isLight)
        lights.push([object, object.intensity])
    })
  }
  const environmentIntensity = scene.environmentIntensity
  const enabled = layer.enabled
  const anchor = new THREE.Group()
  try {
    const handles = Object.fromEntries(await Promise.all(['plain', 'red', 'green'].map(async skinId => [
      skinId,
      await assets.load({ weaponId: 'classic', assetVersion: 'v4', skinId }),
    ])))
    const visual = assets.instantiate(handles.plain)
    anchor.position.fromArray(manifest.view.mountOffset)
    anchor.add(visual.root)
    visual.root.traverse((object) => {
      if (object.isSkinnedMesh)
        object.frustumCulled = false
      if (object.name.startsWith('Arms_'))
        object.visible = false
    })
    visual.player.play('idle', { fade: 0 })
    visual.player.advance(0.35)
    const body = visual.root.getObjectByName('Weapon_Body')
    const material = body.material
    const skeleton = body.skeleton
    const playback = JSON.stringify(visual.player.snapshot())
    const children = visual.root.children.slice()
    const arms = ['Arms_Left', 'Arms_Right'].map(name => visual.root.getObjectByName(name).material)
    const armMaps = arms.map(material => material.map)
    for (const [object] of visibility) object.visible = false
    for (const [light] of lights) light.intensity = 0
    scene.environmentIntensity = 0
    layer.scene.add(anchor)
    layer.setEnabled(true)
    const read = async (points) => {
      await new Promise(requestAnimationFrame)
      render.update()
      return Promise.all(points.map(([x, y]) => render.readViewModelPixel(x, y)))
    }
    const candidates = []
    const { width, height } = render.renderer.domElement
    for (let y = 0.54; y < 0.86; y += 0.04) {
      for (let x = 0.56; x < 0.81; x += 0.03) {
        candidates.push([
          Math.floor(x * width),
          Math.floor(y * height),
        ])
      }
    }
    const mask = await read(candidates)
    const points = candidates.filter((_, index) => mask[index][3] > 0.99)
    check(points.length >= 4, 'Not enough visible gun pixels for emission checks')
    check(material.emissiveMap === material.map && material.emissive.getHex() === 0xFFFFFF, 'An albedo-only skin should glow with its own color texture')
    let maximumError = 0
    const verify = async (expected) => {
      const pixels = await read(points)
      const error = Math.max(...pixels.flatMap(pixel => expected.map((value, channel) => Math.abs(pixel[channel] - value))))
      maximumError = Math.max(maximumError, error)
      check(error < 0.01, `Unexpected HDR emission for ${visual.skinId}: ${error}`)
      check(pixels.every(pixel => pixel[3] > 0.99), 'Changing emission changed the gun silhouette')
    }
    const baseline = await read(points)
    check(baseline.some(pixel => pixel[0] + pixel[1] + pixel[2] > 0.02), 'Albedo emission is not visible with the lights off')
    const linearGreen = new THREE.Color().setRGB(0, 128 / 255, 0, THREE.SRGBColorSpace).g
    for (let cycle = 0; cycle < 2; cycle++) {
      assets.applySkin(visual, handles.red)
      await verify([2, 0, 0])
      assets.applySkin(visual, handles.green)
      await verify([0, 4 * linearGreen, 0])
      assets.applySkin(visual, handles.plain)
      const restored = await read(points)
      const error = Math.max(...restored.flatMap((pixel, index) => pixel.map((value, channel) => Math.abs(value - baseline[index][channel]))))
      maximumError = Math.max(maximumError, error)
      check(error < 0.01, `Albedo emission did not return: ${error}`)
      check(material.emissiveMap === material.map, 'Returning to an albedo-only skin kept a dedicated emission map')
      check(restored.every(pixel => pixel[3] > 0.99), 'Changing emission changed the gun silhouette')
    }
    check(body.material === material && body.skeleton === skeleton, 'Skin replacement rebuilt the material or skeleton')
    check(visual.root.children.length === children.length && children.every((child, index) => visual.root.children[index] === child), 'Skin replacement added another model layer')
    check(JSON.stringify(visual.player.snapshot()) === playback, 'Skin replacement restarted the animation')
    check(arms.every((material, index) => material.map === armMaps[index]), 'Skin replacement changed the arm atlas')
    return {
      samples: points.length,
      swaps: 6,
      maximumError,
      linearGreen,
      albedoUsedAsEmission: true,
    }
  }
  finally {
    anchor.removeFromParent()
    assets.dispose()
    resources.dispose()
    for (const [object, visible] of visibility) object.visible = visible
    for (const [light, intensity] of lights) light.intensity = intensity
    scene.environmentIntensity = environmentIntensity
    layer.setEnabled(enabled)
    await new Promise(requestAnimationFrame)
    render.update()
  }
}
