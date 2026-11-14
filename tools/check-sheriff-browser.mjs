import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { weaponAudioProfiles } from '../src/game/weapons/definitions/audio.js'
import { sheriffDefinition } from '../src/game/weapons/definitions/sheriff.js'
import { openBrowser } from './browser-session.mjs'

const output = path.resolve(process.env.SHERIFF_TEST_OUTPUT ?? 'D:/opencode-temp/opencode/sheriff-gameplay-browser')
const url = new URL(process.argv[2] ?? 'http://localhost:5173/')
url.searchParams.set('probes', '0')
url.searchParams.set('editor', '0')
url.searchParams.set('ao', '0')
const report = {
  url: url.href,
  profile: 'sheriff-integration-only',
  errors: [],
  messages: [],
  skins: [],
}
const started = performance.now()
const audioCueCount = Object.values(weaponAudioProfiles).reduce((sum, profile) => sum + Object.keys(profile.cues).length, 0)
let session
try {
  session = await openBrowser({ output, errors: report.errors, messages: report.messages })
  const { send, evaluate, frames } = session
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const probe = globalThis.__SHERIFF_AUDIO_CHECK__ = { analyser: null };
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function(destination, ...args) {
      if (this instanceof GainNode && destination === this.context.destination && !probe.analyser) {
        probe.analyser = this.context.createAnalyser();
        probe.analyser.fftSize = 2048;
        connect.call(this, probe.analyser);
        return connect.call(probe.analyser, destination, ...args);
      }
      return connect.call(this, destination, ...args);
    };
  })()` })
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
      if (performance.now() > end) return reject(new Error('Timeout: ' + ${JSON.stringify(condition)}));
      requestAnimationFrame(check);
    }
    check();
  })`)
  const state = () => evaluate('__RANGE_ROOM__.inspection.player.snapshot().weapons')
  const ready = id => until(`globalThis.__RANGE_ROOM__?.ready &&
    __RANGE_ROOM__.inspection.player.snapshot().weapons.canAct &&
    __RANGE_ROOM__.inspection.player.snapshot().weapons.view.renderActiveId === ${JSON.stringify(id)} &&
    __RANGE_ROOM__.inspection.player.snapshot().weapons.view.action === 'idle'`)
  const key = async (code, value, windowsVirtualKeyCode) => {
    await send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      code,
      key: value,
      windowsVirtualKeyCode,
    })
    await send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      code,
      key: value,
      windowsVirtualKeyCode,
    })
  }
  const mouse = (type, button = 'left') => send('Input.dispatchMouseEvent', {
    type,
    x: 640,
    y: 360,
    button,
    clickCount: 1,
  })
  const screenshot = async (name) => {
    const image = await send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(output, name), Buffer.from(image.data, 'base64'))
  }
  await session.navigate(url.href)
  await send('Page.bringToFront')
  await send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await ready('pistol')
  await until(`__RANGE_ROOM__.inspection.player.snapshot().weapons.audio.bank.cues === ${audioCueCount}`)
  await evaluate(`globalThis.__CLASSIC_ARM_MAP__ =
    __RANGE_ROOM__.render.viewmodel.scene.getObjectByName('Arms_Left').material.map`)
  await mouse('mousePressed')
  await mouse('mouseReleased')
  await until('!!document.pointerLockElement && __RANGE_ROOM__.audio.snapshot().state === \'running\'')
  assert.equal((await state()).lastShot, null, 'first click only unlocks input/audio')
  await key('Digit5', '5', 53)
  await ready('sheriff')
  report.initial = await state()
  assert.equal(report.initial.view.weapon.definitionId, 'sheriff')
  assert.equal(report.initial.view.weapon.magazine, 6)
  assert.equal(report.initial.view.skinId, 'smite')
  report.asset = await evaluate(`(() => {
    const root = __RANGE_ROOM__.render.viewmodel.scene;
    const body = root.getObjectByName('Weapon_Body');
    const left = root.getObjectByName('Arms_Left'), right = root.getObjectByName('Arms_Right');
    globalThis.__SHERIFF_VISUAL_CHECK__ = { body, material: body.material, skeleton: body.skeleton, arms: left.material.map };
    return {
      loadedV1: performance.getEntriesByType('resource').some(entry => entry.name.includes('/weapons/sheriff/v1/model.glb')),
      imageSize: [body.material.map.image.width, body.material.map.image.height],
      armsSize: [left.material.map.image.width, left.material.map.image.height],
      sharedArms: left.material.map === right.material.map && left.material.map === __CLASSIC_ARM_MAP__,
      temporaryLabel: document.querySelector('.weapon-readout strong').textContent.includes('临时参数'),
      sounds: performance.getEntriesByType('resource').filter(entry => entry.name.includes('/audio/sheriff/')).length
    };
  })()`)
  assert.equal(report.asset.loadedV1, true)
  assert.equal(report.asset.sharedArms, true)
  assert.equal(report.asset.temporaryLabel, true)
  assert.deepEqual(report.asset.armsSize, [32, 32])
  assert.deepEqual(report.asset.imageSize, [2048, 2048])
  assert.equal(report.asset.sounds, 4)
  for (const skinId of [...sheriffDefinition.assets.skinIds, 'smite']) {
    if ((await state()).view.skinId !== skinId) {
      await key('KeyK', 'k', 75)
      await until(`__RANGE_ROOM__.inspection.player.snapshot().weapons.view.skinId === ${JSON.stringify(skinId)}`)
    }
    const identity = await evaluate(`(() => {
      const root = __RANGE_ROOM__.render.viewmodel.scene;
      const body = root.getObjectByName('Weapon_Body'), proof = __SHERIFF_VISUAL_CHECK__;
      return {
        sameMesh: body === proof.body,
        sameMaterial: body.material === proof.material,
        sameSkeleton: body.skeleton === proof.skeleton,
        sameArms: root.getObjectByName('Arms_Left').material.map === proof.arms &&
          root.getObjectByName('Arms_Right').material.map === proof.arms,
        loaderUsesSkin: root.getObjectByName('Weapon_Magazine').material.map === body.material.map
      };
    })()`)
    assert.ok(Object.values(identity).every(Boolean), `${skinId}: skin swap changed shared state`)
    report.skins.push({ skinId, ...identity })
    await screenshot(`sheriff-${skinId}.png`)
  }
  await mouse('mousePressed')
  await until('__RANGE_ROOM__.inspection.player.snapshot().weapons.lastShot?.instanceId === \'sheriff\'')
  report.waveform = await evaluate(`new Promise(resolve => {
    const analyser = __SHERIFF_AUDIO_CHECK__.analyser;
    const data = new Float32Array(analyser.fftSize), end = performance.now() + 450;
    let peak = 0;
    function sample() {
      analyser.getFloatTimeDomainData(data);
      for (const value of data) peak = Math.max(peak, Math.abs(value));
      if (performance.now() >= end) return resolve({ peak });
      requestAnimationFrame(sample);
    }
    sample();
  })`)
  await mouse('mouseReleased')
  const shot = await state()
  assert.equal(shot.view.weapon.magazine, 5, 'held input cannot turn Sheriff into an automatic weapon')
  assert.ok(report.waveform.peak > 0.00001 && report.waveform.peak < 1, 'Sheriff audio must reach the final output')
  report.shot = { magazine: shot.view.weapon.magazine, lastShot: shot.lastShot }
  await key('KeyR', 'r', 82)
  await until('__RANGE_ROOM__.inspection.player.snapshot().weapons.action?.type === \'reload\'')
  assert.equal((await state()).inventory.weapons.find(weapon => weapon.instanceId === 'sheriff').magazine, 5)
  await until(`__RANGE_ROOM__.inspection.player.snapshot().weapons.view.action === 'reloadTactical' &&
    __RANGE_ROOM__.inspection.player.snapshot().weapons.view.playback.current.localTime >= 1.6`)
  report.loader = await evaluate(`(() => {
    const root = __RANGE_ROOM__.render.viewmodel.scene, mesh = root.getObjectByName('Weapon_Magazine');
    root.updateMatrixWorld(true); mesh.skeleton.update();
    const point = mesh.position.clone(), min = [Infinity,Infinity,Infinity], max = [-Infinity,-Infinity,-Infinity];
    for (let i=0;i<mesh.geometry.attributes.position.count;i++) {
      mesh.getVertexPosition(i,point).applyMatrix4(mesh.matrixWorld);
      for (let axis=0;axis<3;axis++) {
        min[axis]=Math.min(min[axis],point.getComponent(axis));
        max[axis]=Math.max(max[axis],point.getComponent(axis));
      }
    }
    return {min,max,size:max.map((value,index)=>value-min[index]),
      localTime:__RANGE_ROOM__.inspection.player.snapshot().weapons.view.playback.current.localTime};
  })()`)
  assert.ok([
    ...report.loader.min,
    ...report.loader.max,
  ].every(Number.isFinite))
  assert.ok(Math.max(...report.loader.size) > 0.05, 'reload loader must not collapse')
  await screenshot('sheriff-reload-loader.png')
  await ready('sheriff')
  const reloaded = await state()
  assert.equal(reloaded.view.weapon.magazine, 6)
  assert.equal(reloaded.view.weapon.reserve, 17)
  report.tacticalReload = { magazine: reloaded.view.weapon.magazine, reserve: reloaded.view.weapon.reserve }
  await mouse('mousePressed', 'right')
  await frames(15)
  report.ads = await evaluate('__RANGE_ROOM__.inspection.player.snapshot().view.ads')
  await mouse('mouseReleased', 'right')
  assert.equal(report.ads, 0, 'source aim clips must not enable Sheriff ADS')
  for (let index = 0; index < 6; index++) {
    await until(`(() => {
      const state=__RANGE_ROOM__.inspection.player.snapshot().weapons;
      return state.inventory.weapons.find(weapon=>weapon.instanceId==='sheriff').nextFireAt <= state.at;
    })()`)
    await mouse('mousePressed')
    await mouse('mouseReleased')
    await until(`__RANGE_ROOM__.inspection.player.snapshot().weapons.inventory.weapons.find(w=>w.instanceId==='sheriff').magazine === ${5 - index}`)
  }
  await key('KeyR', 'r', 82)
  await until('__RANGE_ROOM__.inspection.player.snapshot().weapons.view.action === \'reloadEmpty\'')
  await frames(12)
  await screenshot('sheriff-reload-empty.png')
  await ready('sheriff')
  const emptyReloaded = await state()
  assert.equal(emptyReloaded.view.weapon.magazine, 6)
  assert.equal(emptyReloaded.view.weapon.reserve, 11)
  report.emptyReload = { magazine: emptyReloaded.view.weapon.magazine, reserve: emptyReloaded.view.weapon.reserve }
  await key('KeyT', 't', 84)
  await until(`__RANGE_ROOM__.inspection.player.snapshot().weapons.view.action === 'inspect' &&
    __RANGE_ROOM__.inspection.player.snapshot().weapons.view.playback.current.localTime >= 0.5`)
  await screenshot('sheriff-inspect.png')
  for (const [code, value, vk, instance] of [
    ['Digit2', '2', 50, 'pistol'],
    ['Digit1', '1', 49, 'rifle'],
    ['Digit3', '3', 51, 'ghost'],
    ['Digit4', '4', 52, 'vandal'],
    ['Digit5', '5', 53, 'sheriff'],
  ]) {
    await key(code, value, vk)
    await ready(instance)
  }
  report.returned = await state()
  assert.equal(report.returned.view.weapon.magazine, 6)
  assert.equal(report.returned.view.visibleInstances, 1)
  assert.ok(report.returned.view.maximumInstances <= 2)
  report.audio = await evaluate('__RANGE_ROOM__.audio.snapshot()')
  for (const role of ['draw', 'shoot', 'reload', 'inspect'])
    assert.ok(report.audio.cues.some(cue => cue.id.endsWith(`sheriff_${role}`)), `Missing Sheriff ${role} cue`)
  await evaluate('__RANGE_ROOM__.engine.destroy()')
  assert.deepEqual(report.errors, [])
  assert.ok(!report.messages.some(message => /PropertyBinding|no target node|Failed to load texture/i.test(message.text ?? '')))
  report.passed = true
}
catch (error) {
  report.passed = false
  report.failure = error.stack
  if (session) {
    report.state = await session.evaluate('globalThis.__RANGE_ROOM__?.snapshot()').catch(() => null)
    const image = await session.send('Page.captureScreenshot', { format: 'png' }).catch(() => null)
    if (image)
      fs.writeFileSync(path.join(output, 'failure.png'), Buffer.from(image.data, 'base64'))
  }
  process.exitCode = 1
}
finally {
  report.totalMs = performance.now() - started
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  session?.close()
  console.log(JSON.stringify({
    passed: report.passed,
    asset: report.asset,
    skins: report.skins,
    waveform: report.waveform,
    tacticalReload: report.tacticalReload,
    emptyReload: report.emptyReload,
    loader: report.loader,
    failure: report.failure,
    errors: report.errors,
    totalMs: report.totalMs,
    report: path.join(output, 'report.json'),
  }, null, 2))
}
