import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { classicDefinition } from '../src/game/weapons/definitions/classic.js'
import { openBrowser } from './browser-session.mjs'

const output = path.resolve(process.env.WEAPON_GAME_TEST_OUTPUT ?? 'D:/opencode-temp/opencode/weapon-gameplay-browser')
const url = new URL(process.argv[2] ?? 'http://localhost:5173/')
url.searchParams.set('probes', '0')
const report = { url: url.href, errors: [], messages: [] }
let session
try {
  session = await openBrowser({ output, errors: report.errors, messages: report.messages })
  const { evaluate, send, frames } = session
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 720,
    deviceScaleFactor: 1,
    mobile: false,
  })
  const until = condition => evaluate(`new Promise((resolve, reject) => {
    const end = performance.now() + 60000;
    function check() {
      if (${condition}) return resolve(true);
      if (performance.now() > end) return reject(new Error('Timed out: ' + ${JSON.stringify(condition)}));
      requestAnimationFrame(check);
    }
    check();
  })`)
  const state = () => evaluate('__RANGE_ROOM__.inspection.player.snapshot().weapons')
  const key = async (code, key, virtualKey) => {
    await send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      code,
      key,
      windowsVirtualKeyCode: virtualKey,
    })
    await send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      code,
      key,
      windowsVirtualKeyCode: virtualKey,
    })
  }
  const mouse = (type, button = 'left') => send('Input.dispatchMouseEvent', {
    type,
    x: 640,
    y: 360,
    button,
    clickCount: 1,
  })
  const click = async () => {
    await mouse('mousePressed')
    await mouse('mouseReleased')
  }
  const screenshot = async (name) => {
    const image = await send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(output, name), Buffer.from(image.data, 'base64'))
  }
  const ready = instanceId => until(`globalThis.__RANGE_ROOM__?.ready && __RANGE_ROOM__.inspection.player.snapshot().weapons.canAct && __RANGE_ROOM__.inspection.player.snapshot().weapons.view.renderActiveId === '${instanceId}'`)
  const idleReady = instanceId => until(`globalThis.__RANGE_ROOM__?.ready && __RANGE_ROOM__.inspection.player.snapshot().weapons.canAct && __RANGE_ROOM__.inspection.player.snapshot().weapons.view.renderActiveId === '${instanceId}' && __RANGE_ROOM__.inspection.player.snapshot().weapons.view.action === 'idle' && __RANGE_ROOM__.inspection.player.snapshot().weapons.view.playback?.current?.weight > .999`)
  const cycleToSkin = async (skinId) => {
    for (let attempt = 0; attempt <= classicDefinition.assets.skinIds.length; attempt++) {
      const previous = (await state()).view.skinId
      if (previous === skinId)
        return
      await key('KeyK', 'k', 75)
      await until(`__RANGE_ROOM__.inspection.player.snapshot().weapons.view.skinId !== ${JSON.stringify(previous)}`)
    }
    throw new Error(`Skin cycle did not reach ${skinId}`)
  }
  const armCoverage = async () => {
    await evaluate('__RANGE_ROOM__.engine.pause()')
    try {
      return await evaluate('__ARM_CULLING_CHECK__.measureArmCoverage(__RANGE_ROOM__)')
    }
    finally {
      await evaluate('__RANGE_ROOM__.engine.resume()')
    }
  }
  await session.navigate(report.url)
  await send('Page.bringToFront')
  await send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await ready('pistol')
  report.initial = await state()
  assert.equal(report.initial.view.skinId, 'ag')
  report.optimizedAsset = await evaluate(`(() => {
    const scene = __RANGE_ROOM__.render.viewmodel.scene;
    const body = scene.getObjectByName('Weapon_Body'), magazine = scene.getObjectByName('Weapon_Magazine');
    return { bodyTriangles: body.geometry.index.count / 3, magazineTriangles: magazine.geometry.index.count / 3,
      textureSize: [body.material.map.image.width, body.material.map.image.height],
      albedoEmission: body.material.emissiveMap === body.material.map && body.material.emissive.getHex() === 0xFFFFFF,
      loadedV4: performance.getEntriesByType('resource').some(e => e.name.includes('/weapons/classic/v4/model.glb')) };
  })()`)
  assert.equal(report.optimizedAsset.bodyTriangles, 1413)
  assert.equal(report.optimizedAsset.magazineTriangles, 158)
  assert.deepEqual(report.optimizedAsset.textureSize, [336, 336])
  assert.equal(report.optimizedAsset.loadedV4, true)
  assert.equal(report.optimizedAsset.albedoEmission, true, 'default skin should use its color texture as emission')
  report.focus = await evaluate(`(() => {
    globalThis.__LOCK_ERRORS__ = [];
    const original = Element.prototype.requestPointerLock;
    Element.prototype.requestPointerLock = function(...args) {
      return Promise.resolve(original.apply(this, args)).catch(error => {
        __LOCK_ERRORS__.push(String(error)); throw error;
      });
    };
    return { focused: document.hasFocus(), visibility: document.visibilityState };
  })()`)
  await screenshot('classic-ready.png')
  await click()
  await until('!!document.pointerLockElement')
  await frames(4)
  report.lock = await state()
  assert.equal(report.lock.inventory.weapons.find(w => w.instanceId === 'pistol').magazine, 12, 'first click only locks')
  const armTestModule = `/@fs/${path.resolve('tests/viewmodel-culling-browser-cases.js').replaceAll('\\', '/')}`
  await evaluate(`import(${JSON.stringify(armTestModule)}).then(module => { globalThis.__ARM_CULLING_CHECK__ = module; })`)
  await idleReady('pistol')
  report.armSwitch = { initial: await armCoverage(), cycles: [] }
  for (const side of ['Left', 'Right'])
    assert.ok(report.armSwitch.initial[side].covered > 0, `Initial Classic ${side} arm has no rendered pixels`)
  for (let index = 0; index < 2; index++) {
    await key('Digit1', '1', 49)
    await idleReady('rifle')
    const rifle = await armCoverage()
    await key('Digit2', '2', 50)
    await idleReady('pistol')
    const pistol = await armCoverage()
    for (const side of ['Left', 'Right']) {
      assert.ok(rifle[side].covered > 0, `Rifle ${side} arm disappeared in cycle ${index + 1}`)
      assert.ok(pistol[side].covered >= Math.max(1, Math.floor(report.armSwitch.initial[side].covered / 2)), `Classic ${side} arm disappeared in cycle ${index + 1}`)
      assert.equal(pistol[side].frustumCulled, false, `Classic ${side} arm can use stale animated bounds`)
      assert.equal(rifle[side].frustumCulled, false, `Rifle ${side} arm can use stale animated bounds`)
      assert.equal(pistol[side].map, report.armSwitch.initial[side].map, `Classic ${side} lost its shared atlas`)
      assert.equal(rifle[side].map, report.armSwitch.initial[side].map, `Rifle ${side} did not share the arm atlas`)
    }
    report.armSwitch.cycles.push({ rifle, pistol })
  }
  await screenshot('classic-after-arm-switch.png')
  await key('KeyT', 't', 84)
  await until('__RANGE_ROOM__.inspection.player.snapshot().weapons.view.action === \'inspect\'')
  await evaluate(`(() => {
    const app = __RANGE_ROOM__, state = app.inspection.player.snapshot().weapons;
    const mesh = app.render.viewmodel.scene.getObjectByName('Weapon_Body');
    const arms = ['Arms_Left','Arms_Right'].map(name => app.render.viewmodel.scene.getObjectByName(name));
    globalThis.__SKIN_PROOF__ = { mesh, material: mesh.material, skeleton: mesh.skeleton, map: mesh.material.map,
      arms: arms.map(a => ({ mesh:a, material:a.material, map:a.material.map })),
      actionId:state.action.actionId, playbackId:state.view.playback.current.playbackId,
      drawCount:state.recentEvents.filter(e=>e.type==='DrawStarted').length };
  })()`)
  await cycleToSkin('sakura')
  report.skinSwap = await evaluate(`(() => {
    const state = __RANGE_ROOM__.inspection.player.snapshot().weapons, proof = __SKIN_PROOF__;
    const mesh = __RANGE_ROOM__.render.viewmodel.scene.getObjectByName('Weapon_Body');
    return { sameMesh: mesh===proof.mesh, sameSkeleton:mesh.skeleton===proof.skeleton,
      sameMaterial:mesh.material===proof.material, changedMap:mesh.material.map!==proof.map,
      albedoEmission:mesh.material.emissiveMap===mesh.material.map && mesh.material.emissive.getHex()===0xFFFFFF,
      sameArms:proof.arms.every(a=>a.mesh.material===a.material && a.material.map===a.map),
      sameAction:state.action?.actionId===proof.actionId, samePlayback:state.view.playback.current.playbackId===proof.playbackId,
      drawCount:state.recentEvents.filter(e=>e.type==='DrawStarted').length, beforeDrawCount:proof.drawCount,
      skin:state.view.skinId, magazine:state.view.weapon.magazine,
      imageSize:[mesh.material.map.image.width,mesh.material.map.image.height], instances:state.view.instances };
  })()`)
  for (const check of [
    'sameMesh',
    'sameSkeleton',
    'sameMaterial',
    'changedMap',
    'albedoEmission',
    'sameArms',
    'sameAction',
    'samePlayback',
  ])
    assert.equal(report.skinSwap[check], true, `skin swap: ${check}`)
  assert.equal(report.skinSwap.drawCount, report.skinSwap.beforeDrawCount)
  assert.equal(report.skinSwap.magazine, 12)
  assert.equal(report.skinSwap.instances, 1)
  assert.deepEqual(report.skinSwap.imageSize, [336, 336])
  await screenshot('classic-sakura-inspect.png')
  await until('__RANGE_ROOM__.inspection.player.snapshot().weapons.view.action === \'idle\'')
  await screenshot('classic-sakura-ready.png')
  await cycleToSkin('smite')
  await mouse('mousePressed')
  await until('__RANGE_ROOM__.inspection.player.snapshot().weapons.lastShot !== null')
  await evaluate('new Promise(resolve => setTimeout(resolve, 450))')
  await mouse('mouseReleased')
  report.classicShot = await state()
  assert.equal(report.classicShot.inventory.weapons.find(w => w.instanceId === 'pistol').magazine, 11, 'Classic is semi automatic')
  assert.ok(report.classicShot.lastShot.payload.impact.hit, 'fixed eye ray hits room collision')
  assert.ok(report.classicShot.lastShot.payload.shotDirection.every(Number.isFinite))
  await key('KeyR', 'r', 82)
  await until('__RANGE_ROOM__.inspection.player.snapshot().weapons.action?.type === \'reload\'')
  await key('Digit1', '1', 49)
  await ready('rifle')
  report.switchInterrupt = await state()
  assert.equal(report.switchInterrupt.inventory.weapons.find(w => w.instanceId === 'pistol').magazine, 11)
  assert.ok(report.switchInterrupt.recentEvents.some(e => e.type === 'ReloadCancelled'))
  assert.equal(report.switchInterrupt.view.visibleInstances, 1)
  assert.ok(report.switchInterrupt.view.maximumInstances <= 2)
  await screenshot('phantom-ready.png')

  await mouse('mousePressed')
  await until('__RANGE_ROOM__.inspection.player.snapshot().weapons.inventory.weapons.find(w => w.instanceId === \'rifle\').magazine <= 26')
  await mouse('mouseReleased')
  report.automatic = await state()
  const shots = report.automatic.recentEvents.filter(e => e.type === 'ShotFired' && e.instanceId === 'rifle')
  assert.ok(shots.length >= 4)
  for (let i = 1; i < shots.length; i++) {
    assert.ok(shots[i].at > shots[i - 1].at)
    assert.ok(Math.abs(shots[i].at - shots[0].at - i * 60 / 660) <= 1 / 60 + 1e-10, 'automatic deadlines accumulate without per-shot tick rounding')
  }
  assert.notDeepEqual(shots[0].payload.shotDirection, shots[1].payload.shotDirection)
  await mouse('mousePressed', 'right')
  await until('__RANGE_ROOM__.inspection.player.snapshot().view.ads > .999 && __RANGE_ROOM__.inspection.player.snapshot().weapons.view.action === \'aim\' && __RANGE_ROOM__.inspection.player.snapshot().weapons.view.playback.current.weight > .999')
  report.ads = await evaluate(`(() => {
    const app = __RANGE_ROOM__, state = app.inspection.player.snapshot();
    return { view: state.view, worldFov: app.camera.fov, viewmodelFov: app.render.viewmodel.camera.fov,
      position: app.camera.position.toArray(), quaternion: app.camera.quaternion.toArray(),
      time: app.engine.time.snapshot(), weaponTime: state.weapons.view.presentationTime };
  })()`)
  assert.equal(report.ads.worldFov, 45)
  assert.equal(report.ads.viewmodelFov, 45)
  assert.deepEqual(report.ads.position, report.ads.view.position)
  assert.deepEqual(report.ads.quaternion, report.ads.view.quaternion)
  assert.equal(report.ads.weaponTime, report.ads.time.presentationTime)
  await screenshot('phantom-ads.png')
  await click()
  await until('__RANGE_ROOM__.inspection.player.snapshot().weapons.view.action === \'fireAds\'')
  report.adsShot = await state()
  assert.equal(report.adsShot.lastShot.payload.aiming, true)
  await mouse('mouseReleased', 'right')
  await key('KeyR', 'r', 82)
  await until('__RANGE_ROOM__.inspection.player.snapshot().weapons.view.action === \'reloadTactical\'')
  await screenshot('phantom-reload.png')
  await until('__RANGE_ROOM__.inspection.player.snapshot().weapons.inventory.weapons.find(w => w.instanceId === \'rifle\').magazine === 30 && !__RANGE_ROOM__.inspection.player.snapshot().weapons.action')
  report.reload = await state()
  assert.ok(report.reload.inventory.weapons.find(w => w.instanceId === 'rifle').reserve < 90)
  await key('KeyT', 't', 84)
  await until('__RANGE_ROOM__.inspection.player.snapshot().weapons.view.action === \'inspect\'')
  await evaluate('new Promise(resolve => setTimeout(resolve, 550))')
  await screenshot('phantom-inspect.png')
  await click()
  await until('__RANGE_ROOM__.inspection.player.snapshot().weapons.recentEvents.some(e => e.type === \'InspectCancelled\')')
  report.inspectInterrupt = await state()
  assert.equal(report.inspectInterrupt.inventory.weapons.find(w => w.instanceId === 'rifle').magazine, 29)

  await send('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x: 640,
    y: 360,
    deltaX: 0,
    deltaY: 100,
  })
  await ready('pistol')
  await key('KeyQ', 'q', 81)
  await ready('rifle')
  report.previous = await state()
  const beforeEditorEpoch = report.previous.epoch
  await key('KeyV', 'v', 86)
  await until('__RANGE_ROOM__.snapshot().inspection.cameraMode === \'fly\'')
  await frames(2)
  report.editor = await evaluate('({ weapon: __RANGE_ROOM__.inspection.player.snapshot().weapons, enabled: __RANGE_ROOM__.render.viewmodel.enabled, hudHidden: document.querySelector(".weapon-hud").hidden })')
  assert.equal(report.editor.enabled, false)
  assert.equal(report.editor.hudHidden, true)
  await evaluate('new Promise(resolve => setTimeout(resolve, 300))')
  await key('KeyV', 'v', 86)
  await ready('rifle')
  report.resumed = await state()
  assert.ok(report.resumed.epoch > beforeEditorEpoch)
  assert.equal(report.resumed.inventory.weapons.find(w => w.instanceId === 'rifle').magazine, 29)
  assert.equal(report.resumed.view.visibleInstances, 1)
  await click()
  await until('!!document.pointerLockElement')
  report.pause = await evaluate(`(async () => {
    const app = __RANGE_ROOM__;
    app.engine.pause();
    const before = app.engine.time.snapshot();
    await new Promise(resolve => setTimeout(resolve, 200));
    return { before, after: app.engine.time.snapshot() };
  })()`)
  assert.equal(report.pause.before.fixedElapsed, report.pause.after.fixedElapsed)
  await click()
  await key('Digit2', '2', 50)
  await key('Digit1', '1', 49)
  await key('Digit2', '2', 50)
  await key('KeyR', 'r', 82)
  await key('KeyT', 't', 84)
  await evaluate('__RANGE_ROOM__.engine.resume()')
  await ready('pistol')
  report.afterPause = await state()
  assert.equal(report.afterPause.inventory.weapons.find(w => w.instanceId === 'rifle').magazine, 29, 'paused fire is discarded')
  assert.equal(report.afterPause.inventory.weapons.find(w => w.instanceId === 'pistol').magazine, 11)
  assert.equal(report.afterPause.action, null, 'paused reload and inspect are discarded')
  await key('Home', 'Home', 36)
  await until('__RANGE_ROOM__.inspection.player.snapshot().weapons.inventory.weapons.find(w => w.instanceId === \'pistol\').magazine === 12')
  await ready('pistol')
  report.respawn = await state()
  assert.equal(report.respawn.inventory.weapons.find(w => w.instanceId === 'pistol').magazine, 12)
  assert.equal(report.respawn.inventory.weapons.find(w => w.instanceId === 'rifle').magazine, 30)
  assert.ok(report.respawn.view.maximumInstances <= 2)
  report.repeatCycles = []
  for (let index = 0; index < 3; index++) {
    await key('Digit1', '1', 49)
    await ready('rifle')
    await key('Digit2', '2', 50)
    await ready('pistol')
    const previousSkin = (await state()).view.skinId
    const skins = classicDefinition.assets.skinIds
    const expectedSkin = skins[(skins.indexOf(previousSkin) + 1) % skins.length]
    await key('KeyK', 'k', 75)
    await until(`__RANGE_ROOM__.inspection.player.snapshot().weapons.view.skinId === '${expectedSkin}'`)
    const current = await state()
    assert.equal(current.view.visibleInstances, 1)
    assert.ok(current.view.maximumInstances <= 2)
    assert.equal(current.inventory.weapons.find(w => w.instanceId === 'pistol').magazine, 12)
    assert.equal(await evaluate(`(() => {
      const material = __RANGE_ROOM__.render.viewmodel.scene.getObjectByName('Weapon_Body').material;
      return material.emissiveMap === material.map && material.emissive.getHex() === 0xFFFFFF;
    })()`), true, 'repeated K presses must keep the current skin texture as its emission')
    report.repeatCycles.push({ skin: current.view.skinId, instances: current.view.instances, maximumInstances: current.view.maximumInstances })
  }
  report.disposal = await evaluate(`(() => {
    const app = __RANGE_ROOM__, weapons = app.inspection.player.weapons, scene = app.render.viewmodel.scene;
    app.engine.destroy();
    return { view: weapons.snapshot().view, hudCount: document.querySelectorAll('.weapon-hud').length,
      meshes: scene.children.filter(child => !child.isLight).length };
  })()`)
  assert.equal(report.disposal.view.instances, 0)
  assert.equal(report.disposal.hudCount, 0)
  assert.equal(report.disposal.meshes, 0)
  const gameOnly = new URL(report.url)
  gameOnly.searchParams.set('editor', '0')
  await session.navigate(gameOnly.href)
  await send('Page.bringToFront')
  await ready('pistol')
  assert.equal(await evaluate('document.querySelectorAll(".room-inspection").length'), 0)
  await click()
  await until('!!document.pointerLockElement')
  await click()
  await until('__RANGE_ROOM__.inspection.player.snapshot().weapons.view.weapon?.magazine === 11')
  await key('Digit1', '1', 49)
  await ready('rifle')
  report.gameOnly = await state()
  await screenshot('game-only-phantom.png')
  await key('Digit2', '2', 50)
  await ready('pistol')
  await cycleToSkin('sakura')
  report.gameOnlySkin = await state()
  assert.equal(report.gameOnlySkin.view.weapon.magazine, 11, 'switching and changing skin preserve spent ammunition without Editor')
  assert.equal(report.gameOnlySkin.view.visibleInstances, 1)
  await evaluate(`import(${JSON.stringify(armTestModule)}).then(module => { globalThis.__ARM_CULLING_CHECK__ = module; })`)
  await idleReady('pistol')
  report.gameOnlyArmReturn = await armCoverage()
  for (const side of ['Left', 'Right']) {
    assert.ok(report.gameOnlyArmReturn[side].covered > 0, `Classic ${side} arm disappeared without Editor`)
    assert.equal(report.gameOnlyArmReturn[side].frustumCulled, false)
  }
  await screenshot('game-only-classic-sakura.png')
  await evaluate('__RANGE_ROOM__.engine.destroy()')
  assert.deepEqual(report.errors, [])
  assert.ok(!report.messages.some(m => /PropertyBinding|no target node|Failed to load texture/i.test(m.text ?? '')))
  report.passed = true
}
catch (error) {
  report.passed = false
  report.failure = error.stack
  if (session) {
    report.state = await session.evaluate('({ game: globalThis.__RANGE_ROOM__?.snapshot(), lockErrors: globalThis.__LOCK_ERRORS__, focused: document.hasFocus() })').catch(() => null)
    const image = await session.send('Page.captureScreenshot', { format: 'png' }).catch(() => null)
    if (image)
      fs.writeFileSync(path.join(output, 'failure.png'), Buffer.from(image.data, 'base64'))
  }
  process.exitCode = 1
}
finally {
  fs.mkdirSync(output, { recursive: true })
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({
    passed: report.passed,
    failure: report.failure,
    errors: report.errors,
    armSwitch: report.armSwitch,
    gameOnlyArmReturn: report.gameOnlyArmReturn,
    report: path.join(output, 'report.json'),
  }, null, 2))
  session?.close()
}
