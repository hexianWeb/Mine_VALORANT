import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { weaponAudioProfiles } from '../src/game/weapons/definitions/audio.js'
import { judgeDefinition } from '../src/game/weapons/definitions/judge.js'
import { odinDefinition } from '../src/game/weapons/definitions/odin.js'
import { openBrowser } from './browser-session.mjs'

const output = path.resolve(process.env.JUDGE_ODIN_TEST_OUTPUT ?? 'D:/opencode-temp/opencode/judge-odin-gameplay-browser')
const url = new URL(process.argv[2] ?? 'http://localhost:5173/')
url.searchParams.set('probes', '0')
url.searchParams.set('editor', '0')
url.searchParams.set('ao', '0')
const report = {
  url: url.href,
  profile: 'judge-odin-integration-only',
  errors: [],
  messages: [],
  weapons: [],
}
const started = performance.now()
const cueCount = Object.values(weaponAudioProfiles).reduce((sum, profile) => sum + Object.keys(profile.cues).length, 0)
let session
try {
  session = await openBrowser({ output, errors: report.errors, messages: report.messages })
  const { send, evaluate, frames } = session
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const probe = globalThis.__HEAVY_AUDIO__ = { analyser: null };
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function(destination,...args) {
      if(this instanceof GainNode && destination === this.context.destination && !probe.analyser) {
        probe.analyser=this.context.createAnalyser(); probe.analyser.fftSize=2048;
        connect.call(this,probe.analyser);
        return connect.call(probe.analyser,destination,...args);
      }
      return connect.call(this,destination,...args);
    };
  })()` })
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 720,
    deviceScaleFactor: 1,
    mobile: false,
  })
  const until = condition => evaluate(`new Promise((resolve,reject) => {
    const end=performance.now()+60000;
    function check() {
      if(${condition}) return resolve(true);
      const error=document.querySelector('.unsupported');
      if(error&&!error.hidden&&error.textContent.includes('加载失败')) return reject(new Error(error.textContent));
      if(performance.now()>end) return reject(new Error('Timeout: '+${JSON.stringify(condition)}));
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
  const feed = () => evaluate(`(() => {
    const state=__RANGE_ROOM__.inspection.player.snapshot().weapons;
    const root=__RANGE_ROOM__.render.viewmodel.scene;
    const names=state.activeId==='judge'
      ? ['bullet4','bullet3','bullet2','bullet1','bullet0']
      : ['group_8','group_7','group_6','group_5','group_4','group_3','group_2','group_1'];
    const scales=names.map(name=>root.getObjectByName(name).scale.toArray());
    return {magazine:state.view.weapon.magazine,visible:scales.filter(scale=>scale[0]>.5).length,
      scales,samples:state.view.playback.controls.samples};
  })()`)
  await session.navigate(url.href)
  await send('Page.bringToFront')
  await send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await ready('pistol')
  await until(`__RANGE_ROOM__.inspection.player.snapshot().weapons.audio.bank.cues === ${cueCount}`)
  const initialInventory = (await state()).inventory.weapons
  await evaluate(`globalThis.__COMMON_ARMS__=__RANGE_ROOM__.render.viewmodel.scene.getObjectByName('Arms_Left').material.map`)
  await mouse('mousePressed')
  await mouse('mouseReleased')
  await until('!!document.pointerLockElement && __RANGE_ROOM__.audio.snapshot().state === \'running\'')
  assert.equal((await state()).lastShot, null, 'initial capture click must not fire')

  for (const [definition, code, digit, vk, window] of [
    [judgeDefinition, 'Digit6', '6', 54, 5],
    [odinDefinition, 'Digit7', '7', 55, 8],
  ]) {
    const id = definition.id
    const result = { id, skins: [] }
    report.weapons.push(result)
    await key(code, digit, vk)
    await ready(id)
    const initial = await state()
    assert.equal(initial.view.weapon.magazine, definition.capacity)
    result.asset = await evaluate(`(() => {
      const root=__RANGE_ROOM__.render.viewmodel.scene;
      const body=root.getObjectByName('Weapon_Body'),left=root.getObjectByName('Arms_Left'),right=root.getObjectByName('Arms_Right');
      globalThis.__HEAVY_VISUAL__={body,material:body.material,skeleton:body.skeleton,arms:left.material.map};
      return {
        loaded:performance.getEntriesByType('resource').some(entry=>entry.name.includes('/weapons/${id}/v1/model.glb')),
        image:[body.material.map.image.width,body.material.map.image.height],
        arms:[left.material.map.image.width,left.material.map.image.height],
        sharedArms:left.material.map===right.material.map && left.material.map===__COMMON_ARMS__,
        temporaryLabel:document.querySelector('.weapon-readout strong').textContent.includes('临时参数'),
        sounds:performance.getEntriesByType('resource').filter(entry=>entry.name.includes('/audio/${id}/')).length
      };
    })()`)
    assert.equal(result.asset.loaded, true)
    assert.equal(result.asset.sharedArms, true)
    assert.equal(result.asset.temporaryLabel, true)
    assert.equal(result.asset.sounds, 4)
    assert.deepEqual(result.asset.image, [2048, 2048])
    assert.deepEqual(result.asset.arms, [32, 32])
    result.initialFeed = await feed()
    assert.equal(result.initialFeed.visible, window)
    for (const skinId of [...definition.assets.skinIds, 'smite']) {
      if ((await state()).view.skinId !== skinId) {
        await key('KeyK', 'k', 75)
        await until(`__RANGE_ROOM__.inspection.player.snapshot().weapons.view.skinId === ${JSON.stringify(skinId)}`)
      }
      const identity = await evaluate(`(() => {
        const root=__RANGE_ROOM__.render.viewmodel.scene,body=root.getObjectByName('Weapon_Body'),proof=__HEAVY_VISUAL__;
        return {
          mesh:body===proof.body,material:body.material===proof.material,skeleton:body.skeleton===proof.skeleton,
          arms:root.getObjectByName('Arms_Left').material.map===proof.arms && root.getObjectByName('Arms_Right').material.map===proof.arms,
          magazineMap:root.getObjectByName('Weapon_Magazine').material.map===body.material.map
        };
      })()`)
      assert.ok(Object.values(identity).every(Boolean))
      result.skins.push({ skinId, ...identity })
      await screenshot(`${id}-${skinId}.png`)
    }
    await evaluate(`(() => {
      const trace=globalThis.__FEED_TRACE__={active:true,levels:[],shots:[],peak:0};
      const seen=new Set(),data=new Float32Array(__HEAVY_AUDIO__.analyser.fftSize);
      function sample() {
        if(!trace.active) return;
        const state=__RANGE_ROOM__.inspection.player.snapshot().weapons;
        const root=__RANGE_ROOM__.render.viewmodel.scene;
        const names=${JSON.stringify(id === 'judge'
          ? [
              'bullet4',
              'bullet3',
              'bullet2',
              'bullet1',
              'bullet0',
            ]
          : [
              'group_8',
              'group_7',
              'group_6',
              'group_5',
              'group_4',
              'group_3',
              'group_2',
              'group_1',
            ])};
        const magazine=state.view.weapon.magazine;
        if(trace.levels.at(-1)?.magazine!==magazine) {
          const visible=names.filter(name=>root.getObjectByName(name).scale.x>.5).length;
          trace.levels.push({magazine,visible});
        }
        for(const event of state.recentEvents) {
          if(event.type!=='ShotFired' || event.instanceId!=='${id}' || seen.has(event.payload.shotSequence)) continue;
          seen.add(event.payload.shotSequence);
          trace.shots.push({at:event.at,sequence:event.payload.shotSequence,magazine:event.payload.weapon.magazine,
            pellets:event.payload.pellets?.length ?? 1,seed:event.payload.seed});
          if(!trace.firstShot) trace.firstShot=event;
        }
        __HEAVY_AUDIO__.analyser.getFloatTimeDomainData(data);
        for(const value of data) trace.peak=Math.max(trace.peak,Math.abs(value));
        requestAnimationFrame(sample);
      }
      sample();
    })()`)
    await mouse('mousePressed')
    await until(`__RANGE_ROOM__.inspection.player.snapshot().weapons.inventory.weapons.find(w=>w.instanceId==='${id}').magazine===0`)
    await mouse('mouseReleased')
    await until('__RANGE_ROOM__.inspection.player.snapshot().weapons.view.weapon.magazine===0')
    await frames(2)
    result.fire = await evaluate('(__FEED_TRACE__.active=false,__FEED_TRACE__)')
    assert.equal(result.fire.shots.length, definition.capacity)
    assert.equal(result.fire.shots.at(-1).sequence, definition.capacity)
    for (const level of result.fire.levels)
      assert.equal(level.visible, Math.min(level.magazine, window), `${id}: feed=${JSON.stringify(level)}`)
    assert.equal(result.fire.levels.at(-1).visible, 0)
    const span = result.fire.shots.at(-1).at - result.fire.shots[0].at
    assert.ok(Math.abs(span - (definition.capacity - 1) * definition.fire.interval) < 1 / 60 + 1e-6, `${id}: wrong real cadence ${span}`)
    assert.ok(result.fire.peak > 0.00001 && result.fire.peak < 1, `${id}: final output absent/clipping`)
    if (id === 'judge') {
      assert.ok(result.fire.shots.every(shot => shot.pellets === 12))
      const pellets = result.fire.firstShot.payload.pellets
      assert.equal(new Set(pellets.map(pellet => JSON.stringify(pellet.direction))).size, 12)
      assert.ok(pellets.every(pellet => Math.abs(Math.hypot(...pellet.direction) - 1) < 1e-10))
    }
    const audio = await evaluate('__RANGE_ROOM__.audio.snapshot()')
    assert.equal(audio.cues.filter(cue => cue.id.endsWith(`${id}_shoot`)).length, definition.capacity, 'one local shot sound per shell, not per pellet')
    await key('KeyR', 'r', 82)
    await until('__RANGE_ROOM__.inspection.player.snapshot().weapons.view.action===\'reloadEmpty\'')
    await frames(12)
    assert.equal((await feed()).visible, 0, 'reload animation cannot replenish ammo indicators early')
    await screenshot(`${id}-reload-empty.png`)
    await ready(id)
    result.emptyReload = await feed()
    assert.equal(result.emptyReload.magazine, definition.capacity)
    assert.equal(result.emptyReload.visible, window)
    await mouse('mousePressed')
    await until(`__RANGE_ROOM__.inspection.player.snapshot().weapons.inventory.weapons.find(w=>w.instanceId==='${id}').magazine===${definition.capacity - 1}`)
    await mouse('mouseReleased')
    await key('KeyR', 'r', 82)
    await until('__RANGE_ROOM__.inspection.player.snapshot().weapons.view.action===\'reloadTactical\'')
    const beforeFeed = await feed()
    assert.equal(beforeFeed.magazine, definition.capacity - 1)
    assert.equal(beforeFeed.visible, Math.min(window, definition.capacity - 1))
    await ready(id)
    result.tacticalReload = await state()
    assert.equal(result.tacticalReload.view.weapon.magazine, definition.capacity)
    assert.equal(result.tacticalReload.view.weapon.reserve, definition.initialReserve - definition.capacity - 1)
    await mouse('mousePressed', 'right')
    if (id === 'odin') {
      await until('__RANGE_ROOM__.inspection.player.snapshot().view.ads>.99')
      const view = await evaluate('__RANGE_ROOM__.inspection.player.snapshot().view')
      assert.ok(Math.abs(view.viewmodelFov - definition.aim.viewmodelFov) < 0.01)
      result.adsFov = view.viewmodelFov
      await screenshot('odin-ads.png')
      await mouse('mousePressed')
      await until('__RANGE_ROOM__.inspection.player.snapshot().weapons.view.action===\'fireAds\'')
      await mouse('mouseReleased')
      assert.equal((await state()).lastShot.payload.aiming, true)
    }
    else {
      await frames(15)
      assert.equal(await evaluate('__RANGE_ROOM__.inspection.player.snapshot().view.ads'), 0)
    }
    await mouse('mouseReleased', 'right')
    await key('KeyT', 't', 84)
    await until(`__RANGE_ROOM__.inspection.player.snapshot().weapons.view.action==='inspect' &&
      __RANGE_ROOM__.inspection.player.snapshot().weapons.view.playback.current.localTime>=.5`)
    await screenshot(`${id}-inspect.png`)
    const sounds = await evaluate('__RANGE_ROOM__.audio.snapshot()')
    for (const role of ['draw', 'shoot', 'reload', 'inspect'])
      assert.ok(sounds.cues.some(cue => cue.id.endsWith(`${id}_${role}`)), `${id}: missing ${role}`)
  }
  for (const [code, digit, vk, id] of [
    ['Digit1', '1', 49, 'rifle'],
    ['Digit2', '2', 50, 'pistol'],
    ['Digit3', '3', 51, 'ghost'],
    ['Digit4', '4', 52, 'vandal'],
    ['Digit5', '5', 53, 'sheriff'],
    ['Digit6', '6', 54, 'judge'],
    ['Digit7', '7', 55, 'odin'],
  ]) {
    await key(code, digit, vk)
    await ready(id)
  }
  report.returned = await state()
  for (const before of initialInventory.slice(0, 5)) {
    const after = report.returned.inventory.weapons.find(weapon => weapon.instanceId === before.instanceId)
    assert.equal(after.magazine, before.magazine)
    assert.equal(after.reserve, before.reserve)
    assert.equal(after.skinId, before.skinId)
  }
  assert.equal(report.returned.view.visibleInstances, 1)
  assert.ok(report.returned.view.maximumInstances <= 2)
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
    weapons: report.weapons.map(weapon => ({
      id: weapon.id,
      skins: weapon.skins.map(skin => skin.skinId),
      shots: weapon.fire?.shots.length,
      peak: weapon.fire?.peak,
      feedLevels: weapon.fire?.levels.filter((level, index) => index === 0 || level.magazine <= 8),
      adsFov: weapon.adsFov,
      reloaded: weapon.tacticalReload?.view.weapon,
    })),
    failure: report.failure,
    errors: report.errors,
    totalMs: report.totalMs,
    report: path.join(output, 'report.json'),
  }, null, 2))
}
