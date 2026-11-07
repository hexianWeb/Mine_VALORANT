import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import * as THREE from 'three/webgpu'
import { FlyController } from './engine/controls/fly-controller.js'
import { Disposer } from './engine/core/disposer.js'
import { createFloatingTeapot } from './world/floating-teapot.js'
import { createRoomShadows } from './world/room-shadows.js'
import './room-inspection.css'

// Playable hall coordinates, not the GLB bounds (which include roofs and streets).
export const inspectionConfig = Object.freeze({
  center: Object.freeze([0.5, 11.8, 5.5]),
  orbitRadius: Object.freeze([6.5, 4.5]),
  shadowPosition: Object.freeze([-3, 17.35, 3]),
  shadowTarget: Object.freeze([0.5, 9, 5.5]),
})

/** Application-level composition; content, shadows and camera remain independent. */
export function createRoomInspection({ engine, scene, camera, canvas, renderer, room, config = {} }) {
  const settings = {
    ...inspectionConfig,
    ...config,
  }
  const owned = new Disposer()
  const teapot = owned.add(createFloatingTeapot({
    center: new THREE.Vector3().fromArray(settings.center),
    radius: new THREE.Vector2().fromArray(settings.orbitRadius),
  }))
  scene.add(teapot.mesh)
  const shadows = owned.add(createRoomShadows({
    scene,
    renderer,
    roots: [room.root, teapot.mesh],
    position: new THREE.Vector3().fromArray(settings.shadowPosition),
    target: new THREE.Vector3().fromArray(settings.shadowTarget),
  }))
  const initialPosition = camera.position.clone()
  const initialQuaternion = camera.quaternion.clone()
  const forward = new THREE.Vector3()
  camera.getWorldDirection(forward)
  const orbit = owned.add(new OrbitControls(camera, canvas))
  orbit.enableDamping = true
  orbit.maxDistance = 80
  orbit.minDistance = 0.2
  orbit.target.copy(initialPosition).addScaledVector(forward, 6)
  camera.position.copy(initialPosition)
  camera.quaternion.copy(initialQuaternion)
  orbit.enabled = false
  const fly = owned.add(new FlyController(camera, canvas))
  let mode = 'fly'

  const hud = document.createElement('aside')
  hud.className = 'room-inspection'
  hud.setAttribute('aria-label', '飞行与光照观察')
  hud.innerHTML = `
    <div class="inspection-heading"><strong>场景观察</strong><output class="inspection-speed"></output></div>
    <div class="inspection-actions">
      <button type="button" data-action="mode">切换轨道</button>
      <button type="button" data-action="focus">定位茶壶 F</button>
      <button type="button" data-action="reset">复位 R</button>
      <button type="button" data-action="pause">暂停漂浮</button>
      <button type="button" data-action="shadows" aria-pressed="true">阴影：开</button>
    </div>
    <p class="inspection-help"></p>`
  canvas.parentElement.append(hud)
  owned.add(() => hud.remove())
  const button = action => hud.querySelector(`[data-action="${action}"]`)
  const speed = hud.querySelector('.inspection-speed')
  const help = hud.querySelector('.inspection-help')
  const refresh = () => {
    button('mode').textContent = mode === 'fly'
      ? '切换轨道'
      : '切换飞行'
    button('pause').textContent = teapot.paused
      ? '继续漂浮'
      : '暂停漂浮'
    button('shadows').textContent = shadows.enabled
      ? '阴影：开'
      : '阴影：关'
    button('shadows').setAttribute('aria-pressed', String(shadows.enabled))
    help.textContent = mode === 'fly'
      ? '点击画面激活 · 右键拖动视角 · WASD 移动 · Q/E 降/升 · Shift 加速 · 滚轮调速 · Esc 释放'
      : '左键环绕 · 右键平移 · 滚轮缩放 · F 定位茶壶 · R 恢复初始机位'
  }
  const syncOrbit = (target) => {
    // Flush residual orbit damping before moving to another inspection pose.
    orbit.enableDamping = false
    orbit.update()
    orbit.enableDamping = true
    orbit.target.copy(target)
  }
  const api = {
    orbit,
    fly,
    teapot,
    shadows,
    setMode(value) {
      if (!['fly', 'orbit'].includes(value))
        throw new Error(`Unknown inspection camera mode: ${value}`)
      if (value === mode)
        return
      const position = camera.position.clone()
      const quaternion = camera.quaternion.clone()
      const target = camera.getWorldDirection(forward).multiplyScalar(6).add(position)
      syncOrbit(target)
      camera.position.copy(position)
      camera.quaternion.copy(quaternion)
      mode = value
      fly.setEnabled(mode === 'fly')
      orbit.enabled = mode === 'orbit'
      canvas.focus({ preventScroll: true })
      refresh()
    },
    focusTeapot() {
      fly.cancel()
      syncOrbit(teapot.mesh.position)
      camera.position.copy(teapot.mesh.position).add(new THREE.Vector3(0, 1.8, -6.5))
      camera.lookAt(teapot.mesh.position)
      canvas.focus({ preventScroll: true })
    },
    resetCamera() {
      fly.cancel()
      const target = new THREE.Vector3(0, 0, -1).applyQuaternion(initialQuaternion).multiplyScalar(6).add(initialPosition)
      syncOrbit(target)
      camera.position.copy(initialPosition)
      camera.quaternion.copy(initialQuaternion)
      canvas.focus({ preventScroll: true })
    },
    setPaused(value) {
      teapot.setPaused(value)
      refresh()
    },
    setShadows(value) {
      shadows.setEnabled(value)
      refresh()
    },
    snapshot() {
      return {
        cameraMode: mode,
        flySpeed: fly.speed,
        teapot: teapot.snapshot(),
        shadows: shadows.snapshot(),
      }
    },
    dispose: () => owned.dispose(),
  }
  const actions = {
    mode: () => api.setMode(mode === 'fly'
      ? 'orbit'
      : 'fly'),
    focus: () => api.focusTeapot(),
    reset: () => api.resetCamera(),
    pause: () => api.setPaused(!teapot.paused),
    shadows: () => api.setShadows(!shadows.enabled),
  }
  owned.listen(hud, 'click', (event) => {
    const action = event.target.closest('button')?.dataset.action
    actions[action]?.()
  })
  owned.listen(canvas, 'keydown', (event) => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey)
      return
    if (event.code === 'KeyF')
      api.focusTeapot()
    else if (event.code === 'KeyR')
      api.resetCamera()
  })
  owned.add(engine.addSystem('input', {
    name: 'inspection-camera',
    update: ({ time }) => {
      if (mode === 'fly')
        fly.update(time.rawDelta)
      else
        orbit.update()
      const text = mode === 'fly'
        ? `飞行 ${fly.speed.toFixed(1)} m/s`
        : '轨道观察'
      if (speed.textContent !== text)
        speed.textContent = text
    },
  }))
  owned.add(engine.addSystem('animation', {
    name: 'inspection-teapot',
    update: ({ time }) => teapot.update(time.delta),
  }))
  refresh()
  return api
}
