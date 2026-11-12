import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { openBrowser } from './browser-session.mjs'

const output = path.resolve(process.env.WEAPON_AUDIO_TEST_OUTPUT ?? 'D:/opencode-temp/opencode/weapon-audio/browser')
const url = new URL(process.argv[2] ?? 'http://localhost:5173/')
url.searchParams.set('probes', '0')
url.searchParams.set('editor', '0')
const report = { url: url.href, errors: [], messages: [] }
let session
try {
  session = await openBrowser({ output, errors: report.errors, messages: report.messages })
  const { send, evaluate } = session
  // Probe the real final output, without changing gains, sound sources or scheduling.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const probe = globalThis.__AUDIO_PROBE__ = {sources:[], decoded:[], analyser:null, context:null};
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function(destination,...args) {
      if(this instanceof GainNode && destination===this.context.destination && !probe.analyser) {
        probe.context=this.context; probe.analyser=this.context.createAnalyser(); probe.analyser.fftSize=2048;
        connect.call(this,probe.analyser); return connect.call(probe.analyser,destination,...args);
      }
      return connect.call(this,destination,...args);
    };
    const decode=AudioContext.prototype.decodeAudioData;
    AudioContext.prototype.decodeAudioData=function(...args) {
      return decode.apply(this,args).then(buffer=>{
        probe.decoded.push({duration:buffer.duration,channels:buffer.numberOfChannels,length:buffer.length}); return buffer;
      });
    };
    const start=AudioBufferSourceNode.prototype.start, stop=AudioBufferSourceNode.prototype.stop;
    AudioBufferSourceNode.prototype.start=function(when,offset=0,...args) {
      const record={source:this,when,offset,rate:this.playbackRate.value,stops:[],ended:false};
      probe.sources.push(record); this.addEventListener('ended',()=>record.ended=true);
      return start.call(this,when,offset,...args);
    };
    AudioBufferSourceNode.prototype.stop=function(when) {
      probe.sources.findLast(r=>r.source===this)?.stops.push(when); return stop.call(this,when);
    };
  })()` })
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 720,
    deviceScaleFactor: 1,
    mobile: false,
  })
  const until = condition => evaluate(`new Promise((resolve,reject)=>{
    const end=performance.now()+60000;
    function check(){if(${condition})return resolve(true);if(performance.now()>end)return reject(new Error('Timeout: '+${JSON.stringify(condition)}));requestAnimationFrame(check)}check();
  })`)
  const audio = () => evaluate('__RANGE_ROOM__.audio.snapshot()')
  const weapons = () => evaluate('__RANGE_ROOM__.inspection.player.snapshot().weapons')
  const key = async (code, key, windowsVirtualKeyCode) => {
    await send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      code,
      key,
      windowsVirtualKeyCode,
    })
    await send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      code,
      key,
      windowsVirtualKeyCode,
    })
  }
  const mouse = type => send('Input.dispatchMouseEvent', {
    type,
    x: 640,
    y: 360,
    button: 'left',
    clickCount: 1,
  })
  const click = async () => {
    await mouse('mousePressed')
    await mouse('mouseReleased')
  }
  const ready = id => until(`__RANGE_ROOM__.inspection.player.snapshot().weapons.canAct && __RANGE_ROOM__.inspection.player.snapshot().weapons.view.renderActiveId==='${id}'`)
  const waveform = () => evaluate(`new Promise(resolve=>{
    const data=new Float32Array(__AUDIO_PROBE__.analyser.fftSize),end=performance.now()+400;
    let peak=0,rms=0;
    function sample(){__AUDIO_PROBE__.analyser.getFloatTimeDomainData(data);let square=0;for(const value of data){peak=Math.max(peak,Math.abs(value));square+=value*value}rms=Math.max(rms,Math.sqrt(square/data.length));if(performance.now()>=end)return resolve({peak,rms});requestAnimationFrame(sample)}sample();
  })`)
  await session.navigate(report.url)
  await send('Page.bringToFront')
  await send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await until('globalThis.__RANGE_ROOM__?.ready && __RANGE_ROOM__.inspection.player.snapshot().weapons.audio.bank.cues===8')
  await ready('pistol')
  report.initial = { audio: await audio(), decoded: await evaluate('__AUDIO_PROBE__.decoded') }
  assert.equal(report.initial.audio.unlocked, false)
  assert.equal(await evaluate('__AUDIO_PROBE__.sources.length'), 0, 'locked initial draw never produces a source')
  assert.equal(report.initial.decoded.length, 8)
  assert.ok(report.initial.decoded.every(buffer => buffer.duration > 0 && buffer.channels > 0))
  await click()
  await until('!!document.pointerLockElement && __RANGE_ROOM__.audio.snapshot().state===\'running\' && __RANGE_ROOM__.audio.snapshot().unlocked')
  assert.equal((await weapons()).lastShot, null, 'unlock click cannot shoot')
  await click()
  await until('__RANGE_ROOM__.inspection.player.snapshot().weapons.lastShot!==null')
  report.classicWaveform = await waveform()
  assert.ok(report.classicWaveform.peak > 0.00001, 'decoded sound must reach the real output graph')
  assert.ok(report.classicWaveform.peak < 1, 'initial mix leaves output headroom')
  report.classic = await audio()
  assert.equal(report.classic.cues.filter(cue => cue.id.endsWith('classic_shoot')).length, 1)
  await key('Digit1', '1', 49)
  await ready('rifle')
  await mouse('mousePressed')
  await until('__RANGE_ROOM__.inspection.player.snapshot().weapons.inventory.weapons.find(w=>w.instanceId===\'rifle\').magazine<=14')
  report.automaticWaveform = await waveform()
  await mouse('mouseReleased')
  report.automatic = await audio()
  const facts = (await weapons()).recentEvents.filter(event => event.type === 'ShotFired' && event.instanceId === 'rifle')
  const cues = report.automatic.cues.filter(cue => cue.id.endsWith('phantom_shoot'))
  assert.equal(cues.length, facts.length, 'one semantic audio cue per accepted shot, not per view/marker')
  assert.ok(cues.filter(cue => cue.audioAt !== undefined).length >= 2)
  assert.ok(cues.length >= 16)
  assert.ok(report.automaticWaveform.peak > 0.00001 && report.automaticWaveform.peak < 1)
  await key('KeyR', 'r', 82)
  await until('__RANGE_ROOM__.audio.snapshot().cues.some(c=>c.id.endsWith(\'phantom_reload\')&&c.state===\'started\')')
  await key('Digit2', '2', 50)
  await ready('pistol')
  report.interruption = await audio()
  const reload = report.interruption.cues.find(cue => cue.id.endsWith('phantom_reload'))
  assert.ok(['ended', 'cancelled'].includes(reload.state))
  await key('KeyT', 't', 84)
  await until('__RANGE_ROOM__.audio.snapshot().cues.some(c=>c.id.endsWith(\'classic_inspect\')&&c.state===\'started\')')
  report.pause = await evaluate(`(async()=>{
    const app=__RANGE_ROOM__,ctx=__AUDIO_PROBE__.context;app.engine.pause();
    await new Promise(r=>setTimeout(r,50));const before=ctx.currentTime;
    await new Promise(r=>setTimeout(r,150));return {before,after:ctx.currentTime,state:ctx.state};
  })()`)
  assert.equal(report.pause.state, 'suspended')
  assert.equal(report.pause.before, report.pause.after)
  await click()
  assert.equal((await audio()).state, 'suspended', 'click cannot unpause already-unlocked game audio')
  const shotsBefore = (await audio()).cues.filter(cue => cue.id.endsWith('_shoot')).length
  await evaluate('__RANGE_ROOM__.engine.resume()')
  await until('__RANGE_ROOM__.audio.snapshot().state===\'running\'')
  await session.frames(8)
  assert.equal((await audio()).cues.filter(cue => cue.id.endsWith('_shoot')).length, shotsBefore, 'paused fire is never replayed')
  await evaluate('__RANGE_ROOM__.engine.time.timeScale=0')
  await until('__RANGE_ROOM__.audio.snapshot().paused && __RANGE_ROOM__.audio.snapshot().state===\'suspended\'')
  await evaluate('__RANGE_ROOM__.engine.time.timeScale=.5')
  await until('__RANGE_ROOM__.audio.snapshot().anchor?.rate===.5')
  report.halfSpeed = await audio()
  await evaluate('__RANGE_ROOM__.engine.time.timeScale=2')
  await until('__RANGE_ROOM__.audio.snapshot().anchor?.rate===2')
  report.doubleSpeed = await audio()
  assert.ok(report.doubleSpeed.stats.rebuilt > 0)
  const halfAction = report.halfSpeed.cues.find(cue => cue.id.endsWith('classic_inspect'))
  const doubleAction = report.doubleSpeed.cues.find(cue => cue.id === halfAction?.id)
  assert.ok(Math.abs(halfAction.playbackRate - 0.5) < 1e-8)
  assert.ok(Math.abs(doubleAction.playbackRate - 2) < 1e-8)
  assert.ok(doubleAction.offset > 0)
  const anchor = report.doubleSpeed.anchor
  const target = anchor.audio + anchor.latency + (doubleAction.at - anchor.sim) / anchor.rate
  assert.ok(Math.abs(doubleAction.offset - (doubleAction.audioAt - target) * doubleAction.playbackRate) < 1e-8)
  await evaluate('__RANGE_ROOM__.engine.time.timeScale=1')
  await until('__RANGE_ROOM__.audio.snapshot().anchor?.rate===1')
  report.epoch = await evaluate(`(()=>{
    const app=__RANGE_ROOM__,player=app.inspection.player;const before=player.snapshot().weapons.epoch;
    player.setEnabled(false);const hidden=app.audio.snapshot();player.setEnabled(true);return {before,hidden};
  })()`)
  assert.equal(report.epoch.hidden.voices, 0)
  await ready('pistol')
  assert.ok((await weapons()).epoch > report.epoch.before)
  const image = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(output, 'audio-gameplay.png'), Buffer.from(image.data, 'base64'))
  report.unload = await evaluate(`(async()=>{
    const app=__RANGE_ROOM__,runtime=app.runtime,audio=app.audio;await runtime.world.unloadLevel();
    const afterUnload=audio.snapshot();runtime.dispose();return {afterUnload,afterDispose:audio.snapshot(),context:__AUDIO_PROBE__.context.state};
  })()`)
  assert.equal(report.unload.afterUnload.voices, 0)
  assert.equal(report.unload.afterDispose.state, 'closed')
  assert.equal(report.unload.afterDispose.cues.length, 0)
  assert.equal(report.unload.context, 'closed')
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.doubleSpeed.warnings, [])
  report.passed = true
}
catch (error) {
  report.passed = false
  report.failure = error.stack
  report.state = await session?.evaluate('({audio:globalThis.__RANGE_ROOM__?.audio.snapshot(),player:globalThis.__RANGE_ROOM__?.inspection.player.snapshot(),decoded:globalThis.__AUDIO_PROBE__?.decoded,status:document.querySelector("#status")?.textContent,resources:performance.getEntriesByType("resource").map(e=>({name:e.name,duration:e.duration}))})').catch(() => null)
  process.exitCode = 1
}
finally {
  fs.mkdirSync(output, { recursive: true })
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({
    passed: report.passed,
    failure: report.failure,
    errors: report.errors,
    classicWaveform: report.classicWaveform,
    automaticWaveform: report.automaticWaveform,
    report: path.join(output, 'report.json'),
  }, null, 2))
  session?.close()
}
