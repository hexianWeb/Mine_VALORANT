import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { weaponAudioProfiles } from '../src/game/weapons/definitions/audio.js'
import { ghostDefinition } from '../src/game/weapons/definitions/ghost.js'
import { openBrowser } from './browser-session.mjs'

const output = path.resolve(process.env.GHOST_TEST_OUTPUT ?? 'D:/opencode-temp/opencode/ghost-gameplay-browser')
const url = new URL(process.argv[2] ?? 'http://localhost:5173/')
url.searchParams.set('probes', '0')
url.searchParams.set('editor', '0')
url.searchParams.set('ao', '0')
const report = {
  url: url.href,
  profile: 'ghost-integration-only',
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
    const probe = globalThis.__GHOST_AUDIO_CHECK__ = { analyser: null };
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
  await key('Digit3', '3', 51)
  await ready('ghost')
  report.initial = await state()
  assert.equal(report.initial.view.weapon.definitionId, 'ghost')
  assert.equal(report.initial.view.weapon.magazine, ghostDefinition.capacity)
  assert.equal(report.initial.view.skinId, 'freehand')
  report.asset = await evaluate(`(() => {
    const root = __RANGE_ROOM__.render.viewmodel.scene;
    const body = root.getObjectByName('Weapon_Body');
    const left = root.getObjectByName('Arms_Left'), right = root.getObjectByName('Arms_Right');
    globalThis.__GHOST_VISUAL_CHECK__ = { body, material: body.material, skeleton: body.skeleton, arms: left.material.map };
    return {
      loadedV1: performance.getEntriesByType('resource').some(entry => entry.name.includes('/weapons/ghost/v1/model.glb')),
      imageSize: [body.material.map.image.width, body.material.map.image.height],
      armsSize: [left.material.map.image.width, left.material.map.image.height],
      sharedArms: left.material.map === right.material.map && left.material.map === __CLASSIC_ARM_MAP__,
      temporaryLabel: document.querySelector('.weapon-readout strong').textContent.includes('临时参数'),
      ghostSounds: performance.getEntriesByType('resource').filter(entry => entry.name.includes('/audio/ghost/')).length
    };
  })()`)
  assert.equal(report.asset.loadedV1, true)
  assert.equal(report.asset.sharedArms, true)
  assert.equal(report.asset.temporaryLabel, true)
  assert.deepEqual(report.asset.armsSize, [32, 32])
  assert.deepEqual(report.asset.imageSize, [2048, 2048])
  assert.equal(report.asset.ghostSounds, 4)
  for (const skinId of [...ghostDefinition.assets.skinIds, 'freehand']) {
    if ((await state()).view.skinId !== skinId) {
      await key('KeyK', 'k', 75)
      await until(`__RANGE_ROOM__.inspection.player.snapshot().weapons.view.skinId === ${JSON.stringify(skinId)}`)
    }
    const identity = await evaluate(`(() => {
      const root = __RANGE_ROOM__.render.viewmodel.scene;
      const body = root.getObjectByName('Weapon_Body'), proof = __GHOST_VISUAL_CHECK__;
      return {
        sameMesh: body === proof.body,
        sameMaterial: body.material === proof.material,
        sameSkeleton: body.skeleton === proof.skeleton,
        sameArms: root.getObjectByName('Arms_Left').material.map === proof.arms &&
          root.getObjectByName('Arms_Right').material.map === proof.arms
      };
    })()`)
    assert.ok(Object.values(identity).every(Boolean))
    report.skins.push({ skinId, ...identity })
    await screenshot(`ghost-${skinId}.png`)
  }
  await mouse('mousePressed')
  await until('__RANGE_ROOM__.inspection.player.snapshot().weapons.lastShot?.instanceId === \'ghost\'')
  report.waveform = await evaluate(`new Promise(resolve => {
    const analyser = __GHOST_AUDIO_CHECK__.analyser;
    const data = new Float32Array(analyser.fftSize), end = performance.now() + 400;
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
  assert.equal(shot.view.weapon.magazine, ghostDefinition.capacity - 1, 'held Ghost input remains semi-automatic')
  assert.ok(report.waveform.peak > 0.00001 && report.waveform.peak < 1, 'Ghost audio must reach the actual output')
  report.shot = { magazine: shot.view.weapon.magazine, shot: shot.lastShot }
  await key('KeyR', 'r', 82)
  await until('__RANGE_ROOM__.inspection.player.snapshot().weapons.action?.type === \'reload\'')
  assert.equal((await state()).inventory.weapons.find(weapon => weapon.instanceId === 'ghost').magazine, ghostDefinition.capacity - 1)
  await ready('ghost')
  const reloaded = await state()
  assert.equal(reloaded.view.weapon.magazine, ghostDefinition.capacity)
  assert.equal(reloaded.view.weapon.reserve, ghostDefinition.initialReserve - 1)
  report.reload = { magazine: reloaded.view.weapon.magazine, reserve: reloaded.view.weapon.reserve }
  await mouse('mousePressed', 'right')
  await frames(12)
  report.ads = await evaluate('__RANGE_ROOM__.inspection.player.snapshot().view.ads')
  await mouse('mouseReleased', 'right')
  assert.equal(report.ads, 0, 'a source aim clip must not enable Ghost ADS')
  await key('KeyT', 't', 84)
  await until('__RANGE_ROOM__.inspection.player.snapshot().weapons.view.action === \'inspect\'')
  await screenshot('ghost-inspect.png')
  for (const [code, value, vk, instance] of [
    ['Digit2', '2', 50, 'pistol'],
    ['Digit1', '1', 49, 'rifle'],
    ['Digit3', '3', 51, 'ghost'],
  ]) {
    await key(code, value, vk)
    await ready(instance)
  }
  report.returned = await state()
  assert.equal(report.returned.view.weapon.magazine, ghostDefinition.capacity)
  assert.equal(report.returned.view.visibleInstances, 1)
  assert.ok(report.returned.view.maximumInstances <= 2)
  report.audio = await evaluate('__RANGE_ROOM__.audio.snapshot()')
  for (const role of ['draw', 'shoot', 'reload', 'inspect'])
    assert.ok(report.audio.cues.some(cue => cue.id.endsWith(`ghost_${role}`)), `Missing Ghost ${role} cue`)
  await evaluate('__RANGE_ROOM__.engine.destroy()')
  assert.deepEqual(report.errors, [])
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
    reload: report.reload,
    failure: report.failure,
    errors: report.errors,
    totalMs: report.totalMs,
    report: path.join(output, 'report.json'),
  }, null, 2))
}
