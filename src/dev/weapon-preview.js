import * as THREE from 'three/webgpu'
import { ResourceManager } from '../engine/runtime/resource/resource-manager.js'
import { WeaponAssets } from '../game/weapons/assets/weapon-assets.js'
import { classicDefinition } from '../game/weapons/definitions/classic.js'
import { phantomDefinition } from '../game/weapons/definitions/phantom.js'

const resources = new ResourceManager()
const assets = new WeaponAssets({ resources, scopeId: 'browser-validation' })
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
  if (entries.has(weaponId))
    return entries.get(weaponId)
  globalThis.__WEAPON_PREVIEW__.stage = `loading:${weaponId}`
  const definition = weaponId === 'classic'
    ? classicDefinition
    : phantomDefinition
  const handle = await assets.load({
    weaponId,
    assetVersion: definition.assets.assetVersion,
    skinId: definition.assets.defaultSkinId,
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
  document.querySelector('#status').textContent = `${weaponId} · ${role} · ${time.toFixed(2)} s`
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

async function verify() {
  const checks = []
  for (const weaponId of ['classic', 'phantom']) {
    const entry = await load(weaponId)
    const second = assets.instantiate(entry.handle)
    second.player.play('idle')
    second.player.advance(0)
    const before = JSON.stringify(meshState(second.root))
    const roles = Object.keys(entry.handle.manifest.actions)
    for (const role of roles) {
      const clipName = entry.handle.manifest.actions[role]
      const clip = entry.handle.manifest.clips.find(clip => clip.name === clipName)
      for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
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
  ready: false,
}
async function initialize() {
  try {
    globalThis.__WEAPON_PREVIEW__.stage = 'renderer:init'
    await renderer.init()
    await sample('classic', 'idle')
    globalThis.__WEAPON_PREVIEW__.ready = true
  }
  catch (error) {
    globalThis.__WEAPON_PREVIEW__.error = String(error.stack ?? error)
    document.querySelector('#status').textContent = error.message
    console.error(error)
  }
}
initialize()
