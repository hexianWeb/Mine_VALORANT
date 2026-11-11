import { CameraComponent, MeshComponent, MotorComponent, TransformComponent } from '../src/engine/runtime/function/framework/index.js'
import { RangeRoomLevel } from '../src/game/range-room/level.js'

function check(condition, message) {
  if (!condition)
    throw new Error(message)
}

function checkCameraOwnership(runtime, level, editorEnabled, advance) {
  const { camera, input } = runtime
  const { player } = level
  const view = player.owner.requireComponent(CameraComponent)
  const projection = camera.projectionMatrix.clone()
  const inspection = globalThis.__RANGE_ROOM__.inspection
  check(view.camera === camera && view.enabled, 'Player must publish through its CameraComponent to the shared output')
  const modes = editorEnabled
    ? ['fly', 'orbit']
    : ['disabled']
  for (const mode of modes) {
    if (editorEnabled)
      inspection.setMode(mode)
    else
      level.setPlayerEnabled(false)
    check(!player.enabled && !view.enabled && !input.enabled, `${mode} did not release gameplay camera/input`)
    // Deliberately change the observer pose; an accidental presentation writer would snap it back.
    camera.position.x += 0.01
    if (editorEnabled) {
      inspection.fly.setMode(mode)
      check(inspection.fly.enabled === (mode === 'fly') && inspection.orbit.enabled === (mode === 'orbit'), 'Editor camera writers disagree with the active mode')
    }
    const position = camera.position.clone()
    const quaternion = camera.quaternion.clone()
    advance()
    check(camera.position.distanceTo(position) < 1e-9 && camera.quaternion.angleTo(quaternion) < 1e-7, `${mode} pose was overwritten by gameplay presentation`)
    if (editorEnabled) {
      inspection.setMode('player')
      check(!inspection.fly.enabled && !inspection.orbit.enabled, 'Editor still writes after returning to player')
    }
    else {
      player.placeAtCamera()
      level.setPlayerEnabled(true)
    }
    level.tickComponents('presentation', {
      time: {
        ...runtime.engine.time.snapshot(),
        rawDelta: 0,
        delta: 0,
      },
    })
    check(view.enabled && player.enabled && input.enabled, 'Player did not reclaim camera/input')
    check(camera.position.distanceTo(position) < 1e-9 && camera.quaternion.angleTo(quaternion) < 1e-7, 'Camera handoff lost the observer pose')
  }
  check(camera.projectionMatrix.equals(projection), 'CameraComponent changed the runtime projection')
  return {
    sharedOutput: true,
    modes,
    handoff: true,
    projectionPreserved: true,
  }
}

async function checkPlayerCommands(runtime, level, editorEnabled, canvas, advance) {
  const { engine, camera } = runtime
  const { player } = level
  const inspection = globalThis.__RANGE_ROOM__.inspection
  const press = (code) => {
    canvas.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true }))
    canvas.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }))
  }
  const pause = () => {
    // Explicit manual engine.step() is supported while stopped. Re-enter the pause hook
    // before testing DOM events, so Player and Engine agree that no input tick will run.
    engine.resume()
    engine.pause()
  }
  const resumeFixed = (onZeroStep = () => {}) => {
    const before = engine.time.fixedTick
    engine.resume()
    advance()
    check(engine.time.fixedTick === before && engine.time.fixedSteps === 0, 'The first resumed frame must retain the fixed clock')
    onZeroStep()
    for (let frame = 0; engine.time.fixedTick === before && frame < 2; frame++) advance()
    check(engine.time.fixedTick === before + 1, 'Resume did not commit exactly one actual fixed step')
    engine.pause()
  }
  const ready = async (instanceId) => {
    for (let frame = 0; frame < 300; frame++) {
      advance()
      const state = player.weapons.snapshot()
      check(!state.view.error, `Weapon preparation failed: ${state.view.error}`)
      check(state.view.instances <= 2 && state.view.visibleInstances <= 1, 'Weapon presentation exceeded its instance limits')
      if (state.phase === 'Ready' && state.activeId === instanceId && state.view.renderActiveId === instanceId)
        return state
      // Loading resolves outside fixed updates; give the real resource loader/motion path time.
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    throw new Error(`Weapon ${instanceId} did not become gameplay/render ready`)
  }
  pause()
  const position = player.position.clone()
  const view = camera.position.clone()
  const frame = engine.time.frame
  const respawns = player.respawns
  press('Home')
  engine.rendererTick()
  check(engine.state === 'paused' && engine.time.frame === frame, 'DOM input advanced a paused engine')
  check(player.position.equals(position) && camera.position.equals(view) && player.respawns === respawns, 'Home changed paused simulation or presentation')
  resumeFixed(() => check(player.respawns === respawns, 'Home committed without a fixed step'))
  check(player.respawns === respawns + 1, 'Home must work once, including without editor UI')
  check(player.position.toArray().every((value, axis) => Math.abs(value - level.collision.spawn.position[axis]) < 1e-9), 'Home did not return to the level spawn')
  check(Math.abs(camera.position.x - player.position.x) < 1e-9 && Math.abs(camera.position.z - player.position.z) < 1e-9, 'Respawn did not publish the camera in the same fixed step')
  advance()
  check(player.respawns === respawns + 1, 'Home was delivered more than once')
  pause()
  if (editorEnabled)
    document.querySelector('.room-inspection [data-action="reset"]').click()
  else
    inspection.resetCamera()
  canvas.focus()
  press('Home')
  check(player.respawns === respawns + 1, 'Tool reset bypassed the input tick')
  resumeFixed(() => check(player.respawns === respawns + 1, 'Tool reset committed without a fixed step'))
  check(player.respawns === respawns + 2, 'Tool and keyboard reset did not coalesce')
  advance()
  check(player.respawns === respawns + 2, 'A consumed reset leaked into another tick')
  await ready('pistol')
  const weapon = () => {
    const state = player.weapons.snapshot()
    return state.inventory.weapons.find(entry => entry.instanceId === state.activeId)
  }
  const beforeShot = weapon().shotSequence
  check(player.weapons.queue({ type: 'fire' }), 'Ready weapon rejected the fixture shot')
  advance()
  check(weapon().shotSequence === beforeShot + 1, 'Fixture shot did not commit')
  pause()
  const pausedWeapon = weapon()
  const yaw = player.yaw
  const pitch = player.pitch
  press('KeyR')
  press('KeyT')
  player.look(120, -60)
  check(!player.weapons.queue({ type: 'fire' }) && !player.weapons.queue({ type: 'fireHeld', held: true }), 'Paused weapons accepted fire input')
  resumeFixed()
  check(weapon().magazine === pausedWeapon.magazine && weapon().reserve === pausedWeapon.reserve && weapon().shotSequence === pausedWeapon.shotSequence, 'Paused fire or reload changed ammunition')
  check(player.weapons.snapshot().action === null, 'Paused reload/inspect leaked into the resumed fixed step')
  check(player.yaw === yaw && player.pitch === pitch, 'Paused look leaked into the resumed fixed step')
  check(player.respawns === respawns + 2, 'R is reload, not respawn')
  // Slot choices survive a stopped Engine, with only the final target submitted on resume.
  press('Digit1')
  press('Digit2')
  press('Digit1')
  check(player.weapons.snapshot().pendingTarget === null && player.weapons.snapshot().activeId === 'pistol', 'Paused selection changed fixed equipment state')
  resumeFixed(() => check(player.weapons.snapshot().pendingTarget === null, 'Paused selection committed without a fixed step'))
  check(player.weapons.snapshot().pendingTarget === 'rifle', 'Resume did not retain the latest paused slot selection')
  await ready('rifle')
  check(player.weapons.snapshot().view.maximumInstances <= 2, 'Switching allocated more than active plus staged instances')
  return {
    keyboardRespawn: true,
    pausedCommands: true,
    toolsUseInputTick: true,
    noDuplicateCommand: true,
    zeroStepResumePreserved: true,
    pausedActionsDiscarded: true,
    latestPausedSelection: true,
    boundedWeaponInstances: true,
  }
}

/** Exercise real asset ownership, app tool rebinding and fixed-step control after reload. */
export async function checkLevelReload(app, editorEnabled) {
  const { runtime } = app
  const { engine, world, scene, camera, resources, input, physics, render } = runtime
  engine.pause()
  const originalChildren = scene.children.length
  const originalObjects = world.activeLevel.objects.size
  check(originalObjects === 4, 'Room, ground, player and teapot must be composed objects')
  check(world.activeLevel.player.owner.requireComponent(MotorComponent).constructor === world.activeLevel.teapot.requireComponent(MotorComponent).constructor, 'Player and teapot must share Motor')
  for (const object of world.activeLevel.objects.values())
    check(!!object.getComponent(TransformComponent), 'Each spatial object requires Transform')
  check([
    ...world.activeLevel.objects.values(),
  ].filter(object => object.getComponent(MeshComponent)).length === 3, 'Room, ground and teapot must share Mesh')
  const cycles = []
  for (let cycle = 0; cycle < 2; cycle++) {
    const previous = world.activeLevel
    const previousView = previous.player.owner.requireComponent(CameraComponent)
    await world.unloadLevel()
    check(scene.children.length === 0 && previous.objects.size === 0, 'Unload left scene objects attached')
    check(document.querySelectorAll('.room-inspection').length === 0, 'Unload left editor UI attached')
    check(!globalThis.__RANGE_ROOM__, 'Unload left stale diagnostics')
    check(!input.enabled, 'Unloaded player still owns input')
    check(previousView.disposed && !previousView.enabled, 'Unloaded CameraComponent still owns output')
    check(previous.player.weapons.snapshot().disposed && previous.player.weapons.snapshot().view.instances === 0, 'Unload left weapon gameplay or visual instances alive')
    check(!render.viewmodel.enabled && render.viewmodel.scene.children.every(child => child.isLight), 'Unload left weapon roots or effects in the shared render layer')
    const cameraPosition = camera.position.clone()
    previous.tickComponents('presentation', {
      time: engine.time.snapshot(),
    })
    check(camera.position.equals(cameraPosition), 'Unloaded CameraComponent still updates the shared camera')
    const position = previous.player.position.clone()
    previous.tickComponents('fixed', {
      time: engine.time.snapshot(),
    })
    world.tickComponents('fixed', {
      time: engine.time.snapshot(),
    })
    check(position.equals(previous.player.position), 'Unloaded player still participates in component updates')
    check(!resources.has('range-room:skybox-day'), 'Unload left level sky cached')
    const level = await world.loadLevel(() => new RangeRoomLevel({
      scene,
      camera,
      resources,
      input,
      physics,
      render,
      maxAnisotropy: render.renderer.getMaxAnisotropy(),
      config: { probes: false },
    }))
    check(level !== previous && level.player !== previous.player, 'Reload reused a disposed level/player')
    const view = level.player.owner.requireComponent(CameraComponent)
    check(view !== previousView && view.camera === camera, 'Reload must create a new camera component using the same runtime output')
    check(level.objects.size === originalObjects && scene.children.length === originalChildren, 'Reload changed object counts')
    check(document.querySelectorAll('.room-inspection').length === Number(editorEnabled), 'Reload duplicated or omitted editor UI')
    check(globalThis.__RANGE_ROOM__.world === level && globalThis.__RANGE_ROOM__.ready, 'Reload did not rebind diagnostics')
    engine.time.resetDelta()
    let now = performance.now()
    engine.step(now)
    for (let frame = 0; frame < 30; frame++) engine.step(now += 1000 / 60)
    check(level.player.grounded, 'Reloaded player did not settle')
    const canvas = document.querySelector('.webgl')
    canvas.focus()
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true, cancelable: true }))
    check(input.isDown('forward'), 'Player input depends on editor focus setup')
    const start = level.player.position.clone()
    for (let frame = 0; frame < 30; frame++) engine.step(now += 1000 / 60)
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true }))
    check(level.player.position.distanceTo(start) > 0.1, 'Reloaded player cannot move')
    const fixedPosition = level.player.position.clone()
    const timeFrame = engine.time.frame
    const fixedTick = engine.time.fixedTick
    const propElapsed = level.teapot.requireComponent(MotorComponent).elapsed
    const propPosition = level.teapot.requireComponent(TransformComponent).position.clone()
    const viewPosition = camera.position.clone()
    const viewRotation = camera.quaternion.clone()
    const viewOffset = view.currentVerticalOffset
    check(propElapsed > 0 && level.teapot.requireComponent(MeshComponent).root.position.equals(propPosition), 'Frame Motor did not publish its pose to Mesh')
    engine.rendererTick()
    engine.rendererTick()
    check(level.player.position.equals(fixedPosition) && engine.time.frame === timeFrame, 'Rendering advanced simulation')
    check(engine.time.fixedTick === fixedTick && level.teapot.requireComponent(MotorComponent).elapsed === propElapsed, 'Rendering advanced a Motor clock')
    check(camera.position.equals(viewPosition) && camera.quaternion.equals(viewRotation) && view.currentVerticalOffset === viewOffset, 'Rendering advanced CameraComponent presentation')
    let repeatedLogicRejected = false
    try {
      engine.logicalTick()
    }
    catch {
      repeatedLogicRejected = true
    }
    check(repeatedLogicRejected && level.player.position.equals(fixedPosition), 'Repeated logicalTick advanced a completed frame')
    check(globalThis.__RANGE_ROOM__.snapshot().time.fixedTick === fixedTick, 'Diagnostics did not expose committed simulation time')
    cycles.push({
      objects: level.objects.size,
      sceneChildren: scene.children.length,
      movement: level.player.position.distanceTo(start),
      fixedTick,
      propElapsed,
      repeatedLogicRejected,
      input: await checkPlayerCommands(runtime, level, editorEnabled, canvas, () => engine.step(now += 1000 / 60)),
      camera: checkCameraOwnership(runtime, level, editorEnabled, () => engine.step(now += 1000 / 60)),
    })
  }
  engine.destroy()
  check(runtime.state === 'disposed' && scene.children.length === 0, 'Shutdown left runtime/scene alive')
  check(!globalThis.__RANGE_ROOM__, 'Shutdown left diagnostics installed')
  check(document.querySelectorAll('.room-inspection').length === 0, 'Shutdown left tool UI')
  return { editorEnabled, cycles, shutdown: true }
}
