import * as THREE from 'three/webgpu'
import { ResourceManager } from '../engine/runtime/resource/resource-manager.js'
import { WeaponAssets } from '../game/weapons/assets/weapon-assets.js'
import { classicDefinition } from '../game/weapons/definitions/classic.js'
import { phantomDefinition } from '../game/weapons/definitions/phantom.js'
import { weaponPreviewOptions } from './weapon-preview-options.js'

const resources = new ResourceManager()
const options = weaponPreviewOptions(location.search, import.meta.env.DEV)
const assets = new WeaponAssets({ resources, scopeId: 'browser-validation', baseUrl: options.baseUrl })
if (options.candidate) {
  for (const option of document.querySelector('#weapon').options)
    option.disabled = option.value !== options.weapon
}
const scene = new THREE.Scene()
scene.background = new THREE.Color(0x1C2230)
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.005, 100)
scene.add(camera)
scene.add(new THREE.HemisphereLight(0xE6F3FF, 0x646B80, 2.5))
const light = new THREE.DirectionalLight(0xFFFFFF, 2)
light.position.set(2, 4, 3)
scene.add(light)
const renderer = new THREE.WebGPURenderer({
  canvas: document.querySelector('canvas'),
  antialias: true,
})
renderer.setSize(innerWidth, innerHeight)
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1
const entries = new Map()
let active = null
let frame = 0
let disposed = false

function require(condition, message) {
  if (!condition)
    throw new Error(message)
}

async function load(weaponId) {
  require(!options.candidate || weaponId === options.weapon, 'Candidate preview contains only the requested weapon')
  if (entries.has(weaponId))
    return entries.get(weaponId)
  globalThis.__WEAPON_PREVIEW__.stage = `loading:${weaponId}`
  const definition = weaponId === 'classic'
    ? classicDefinition
    : phantomDefinition
  const handle = await assets.load({
    weaponId,
    assetVersion: options.candidate ? options.version : definition.assets.assetVersion,
    skinId: options.candidate ? options.skin : definition.assets.defaultSkinId,
  })
  globalThis.__WEAPON_PREVIEW__.stage = `instantiating:${weaponId}`
  const instance = assets.instantiate(handle)
  const anchor = new THREE.Group()
  anchor.position.fromArray(handle.manifest.view.mountOffset)
  anchor.add(instance.root)
  camera.add(anchor)
  anchor.visible = false
  const entry = { handle, instance, anchor }
  entries.set(weaponId, entry)
  return entry
}

async function sample(weaponId, role, time = 0) {
  cancelAnimationFrame(frame)
  const entry = await load(weaponId)
  for (const other of entries.values()) other.anchor.visible = other === entry
  active = entry
  camera.fov = entry.handle.manifest.view.verticalFov
  camera.updateProjectionMatrix()
  entry.instance.player.play(role, { restart: true, fade: 0 })
  const events = entry.instance.player.advance(time)
  globalThis.__WEAPON_PREVIEW__.stage = `rendering:${weaponId}`
  renderer.render(scene, camera)
  globalThis.__WEAPON_PREVIEW__.stage = 'ready'
  document.querySelector('#weapon').value = weaponId
  const actionSelect = document.querySelector('#action')
  if ([...actionSelect.options].some(option => option.value === role))
    actionSelect.value = role
  document.querySelector('#status').textContent = `${options.candidate ? '候选预览（非发布验收） · ' : ''}${weaponId} · ${role} · ${time.toFixed(2)} s`
  return {
    events,
    state: entry.instance.player.snapshot(),
  }
}

function meshState(root) {
  const meshes = []
  root.updateMatrixWorld(true)
  root.traverse((node) => {
    if (!node.isSkinnedMesh)
      return
    node.skeleton.update()
    require(node.skeleton.boneMatrices.every(Number.isFinite), `${node.name}: invalid bone matrix`)
    meshes.push({
      name: node.name,
      material: node.material.name,
      matrices: Array.from(node.skeleton.boneMatrices),
    })
  })
  return meshes
}

const defaultWeapons = options.candidate
  ? [options.weapon]
  : ['classic', 'phantom']

async function verify({ weapons = defaultWeapons, quick = false } = {}) {
  const checks = []
  for (const weaponId of weapons) {
    const entry = await load(weaponId)
    const second = assets.instantiate(entry.handle)
    second.player.play('idle')
    second.player.advance(0)
    const before = JSON.stringify(meshState(second.root))
    const roles = quick
      ? ['idle', 'reloadEmpty', 'inspect']
      : Object.keys(entry.handle.manifest.actions)
    const fractions = quick
      ? [0, 0.5, 1]
      : [0, 0.25, 0.5, 0.75, 1]
    for (const role of roles) {
      const clipName = entry.handle.manifest.actions[role]
      const clip = entry.handle.manifest.clips.find(clip => clip.name === clipName)
      for (const fraction of fractions) {
        entry.instance.player.play(role, { restart: true, fade: 0 })
        entry.instance.player.advance(clip.duration * fraction)
        meshState(entry.instance.root)
      }
    }
    require(before === JSON.stringify(meshState(second.root)), 'Animation leaked into the second skeleton')
    const a = entry.instance.root.getObjectByName('Weapon_Body')
    const b = second.root.getObjectByName('Weapon_Body')
    require(a.geometry === b.geometry && a.skeleton !== b.skeleton && a.material !== b.material, 'Resource ownership mismatch')
    second.dispose()
    require(second.player.snapshot().stats.actions === 0 && second.player.snapshot().stats.bindings === 0, 'Mixer cache leak')
    await sample(weaponId, 'idle')
    checks.push({
      weaponId,
      roles: roles.length,
      meshCount: meshState(entry.instance.root).length,
      instancesIndependent: true,
    })
  }
  if (!weapons.includes('classic') || !weapons.includes('phantom'))
    return checks
  const classic = entries.get('classic').instance.root
  const phantom = entries.get('phantom').instance.root
  const sharedMap = classic.getObjectByName('Arms_Left').material.map
  require(sharedMap?.image?.width === 32 && sharedMap.image.height === 32, 'Arm atlas must be 32×32')
  for (const side of ['Left', 'Right']) {
    const a = classic.getObjectByName(`Arms_${side}`)
    const b = phantom.getObjectByName(`Arms_${side}`)
    require(a.material.map === sharedMap && b.material.map === sharedMap, `${side}: arm atlas is not shared`)
    require(a.geometry.attributes.uv.count === b.geometry.attributes.uv.count, `${side}: UV count differs`)
    require(a.geometry.attributes.uv.array.every((value, index) => Math.abs(value - b.geometry.attributes.uv.array[index]) < 1e-6), `${side}: UV layout differs`)
  }
  checks.push({
    weaponId: 'shared-arms',
    sharedTexture: true,
    width: 32,
    height: 32,
    matchingUV: true,
  })
  return checks
}

function dispose() {
  cancelAnimationFrame(frame)
  assets.dispose()
  const stats = [
    ...entries.values(),
  ].map(entry => entry.instance.player.snapshot().stats)
  for (const entry of entries.values()) entry.anchor.removeFromParent()
  resources.dispose()
  renderer.dispose()
  disposed = true
  return {
    stats,
    detached: [
      ...entries.values(),
    ].every(entry => entry.instance.root.parent === null),
  }
}

document.querySelector('#play').addEventListener('click', async () => {
  const weaponId = document.querySelector('#weapon').value
  const role = document.querySelector('#action').value
  await sample(weaponId, role)
  let previous = performance.now()
  const tick = (now) => {
    if (disposed)
      return
    active.instance.player.advance(Math.min((now - previous) / 1000, 0.1))
    previous = now
    renderer.render(scene, camera)
    frame = requestAnimationFrame(tick)
  }
  frame = requestAnimationFrame(tick)
})

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
  if (!disposed)
    renderer.render(scene, camera)
})

globalThis.__WEAPON_PREVIEW__ = {
  sample,
  verify,
  dispose,
  options,
  ready: false,
}
async function initialize() {
  try {
    globalThis.__WEAPON_PREVIEW__.stage = 'renderer:init'
    await renderer.init()
    await sample(options.weapon, 'idle')
    globalThis.__WEAPON_PREVIEW__.ready = true
  }
  catch (error) {
    globalThis.__WEAPON_PREVIEW__.error = String(error.stack ?? error)
    document.querySelector('#status').textContent = error.message
    console.error(error)
  }
}
initialize()
