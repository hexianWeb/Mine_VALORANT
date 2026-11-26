import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three/webgpu'
import { AudioSystem } from '../src/engine/runtime/function/audio/audio-system.js'
import { CameraComponent } from '../src/engine/runtime/function/framework/component/camera/camera-component.js'
import { GameObject, TransformComponent } from '../src/engine/runtime/function/framework/index.js'
import { createParticleSystem } from '../src/engine/runtime/function/particle/particle-system.js'
import { createFlowEffectState } from '../src/engine/runtime/function/render/passes/flow-effect.js'
import { buildPipeline } from '../src/engine/runtime/function/render/render-pipeline.js'
import { FlowAudio } from '../src/game/range-room/challenges/flow-audio.js'
import { FlowEffectComponent } from '../src/game/range-room/challenges/flow-controller.js'
import { flowConfig, FlowStateMachine } from '../src/game/range-room/challenges/flow-state.js'
import { FakeAudioContext, FakeParam } from './audio-fixture.mjs'

class FlowFakeAudioContext extends FakeAudioContext {
  filters = []
  oscillators = []

  constructor() {
    super()
    this.durations = new Map()
  }

  async decodeAudioData(bytes) {
    const tag = new Uint8Array(bytes)[0] ?? 0
    const duration = this.durations.get(tag) ?? 5
    await super.decodeAudioData(bytes)
    return {
      tag,
      duration,
      length: Math.round(duration * 44100),
      numberOfChannels: 2,
    }
  }

  createBiquadFilter() {
    const frequency = new FakeParam()
    frequency.setTargetAtTime = function (value, at, tau) {
      this.value = value
      this.events.push({ type: 'target', value, at, tau })
    }
    const Q = new FakeParam()
    const node = {
      type: 'lowpass',
      frequency,
      Q,
      connect() {},
      disconnect() { this.disconnected = true },
    }
    this.filters.push(node)
    return node
  }

  createOscillator() {
    const frequency = new FakeParam()
    frequency.setTargetAtTime = function (value, at, tau) {
      this.value = value
      this.events.push({ type: 'target', value, at, tau })
    }
    const node = {
      type: 'sine',
      frequency,
      starts: [],
      stops: [],
      onended: null,
      connect() {},
      disconnect() { this.disconnected = true },
      start(when) { this.starts.push(when) },
      stop(when) { this.stops.push(when) },
    }
    this.oscillators.push(node)
    return node
  }

  createBufferSource() {
    const source = super.createBufferSource()
    source.playbackRate.setTargetAtTime = function (value, at, tau) {
      this.value = value
      this.events.push({ type: 'target', value, at, tau })
    }
    return source
  }

  createGain() {
    const gain = super.createGain()
    gain.gain.setTargetAtTime = function (value, at, tau) {
      this.value = value
      this.events.push({ type: 'target', value, at, tau })
    }
    return gain
  }
}

test('FlowStateMachine runs enter (0.8s) -> flow (0.25x) -> exit (2.5s) -> leave (0.5s) with accurate curves', () => {
  const machine = new FlowStateMachine()
  const dt = 1 / 60

  // Idle defaults
  assert.equal(machine.phase, 'idle')
  assert.equal(machine.state.timeScale, 1)
  assert.equal(machine.state.screen.active, 0)

  // 1. Enter (0.8s): left-to-right sweep, luminous leading edge, timeScale 1 -> 0.25
  machine.enter()
  let remaining = 5.0
  const enterSweep = []
  const enterEdges = []
  const enterScales = []
  let enteredFired = 0
  for (let i = 0; i < 48; i++) {
    remaining -= dt
    const { state, events } = machine.step(dt, { inFlow: true, remaining })
    if (events.entered)
      enteredFired++
    enterSweep.push(state.screen.sweepEnd)
    enterEdges.push(state.screen.edgeIntensity)
    enterScales.push(state.timeScale)
  }
  assert.equal(enteredFired, 1)
  assert.ok(enterSweep[0] < 0.05 && enterSweep.at(-1) > 1.0, 'enter sweep moves left to right across screen')
  assert.ok(Math.max(...enterEdges) > 0.9, 'enter carries bright ice-blue leading edge')
  assert.ok(enterScales[0] > 0.95 && Math.abs(enterScales.at(-1) - flowConfig.flowTimeScale) < 0.02)
  assert.equal(machine.phase, 'flow')

  // 2. Sustained flow (well before 2.5s exit window): 0.25x world speed, 4.4s breathing, ~1.0s alternating ticks
  const ticks = []
  const breaths = []
  const vignettes = []
  for (let i = 0; i < 360; i++) { // 6 seconds at remaining = 4.0 (simulated sustained flow)
    const { state, events } = machine.step(dt, { inFlow: true, remaining: 4.0 })
    assert.equal(state.phase, 'flow')
    assert.equal(state.timeScale, 0.25)
    assert.equal(state.blurPx, 0)
    assert.ok(state.fovOffset < -5)
    assert.ok(state.enemyGlow > 0.85)
    vignettes.push(state.vignette)
    if (events.tick)
      ticks.push({ t: i * dt, kind: events.tick })
    if (events.breath)
      breaths.push({ t: i * dt, kind: events.breath })
  }
  assert.ok(Math.max(...vignettes) - Math.min(...vignettes) > 0.14, 'vignette breathes gently with breathing cycle')
  assert.ok(ticks.length >= 5 && ticks.length <= 7, `expected ~6 ticks over 6s, got ${ticks.length}`)
  for (let i = 1; i < ticks.length; i++) {
    assert.notEqual(ticks[i].kind, ticks[i - 1].kind, 'clock ticks alternate high/low')
    assert.ok(Math.abs((ticks[i].t - ticks[i - 1].t) - 1.0) < 0.05)
  }
  assert.equal(breaths[0].kind, 'inhale')
  assert.equal(breaths[1].kind, 'exhale')
  assert.equal(breaths[2].kind, 'inhale')
  assert.ok(Math.abs((breaths[2].t - breaths[0].t) - 4.4) < 0.08, 'breath cycle is ~4.4s in sustained flow')

  // 3. Exit (last 2.5s): blur -> 3.4px, timeScale 0.25 -> 1, tick 1.0 -> 0.2s, breath shortens, drone pitch/cutoff rise
  let exitEnd = null
  for (let i = 0; i < 150; i++) {
    const rem = Math.max(0, 2.5 - (i + 1) * dt)
    const { state } = machine.step(dt, { inFlow: true, remaining: rem })
    exitEnd = state
  }
  assert.equal(exitEnd.phase, 'exit')
  assert.ok(exitEnd.blurPx > 2.8 && exitEnd.blurPx <= flowConfig.maxBlurPx + 1e-6, `blur near 3.4px: ${exitEnd.blurPx}`)
  assert.ok(exitEnd.timeScale > 0.92 && exitEnd.timeScale <= 1)
  assert.ok(exitEnd.tickInterval < 0.28)
  assert.ok(exitEnd.breathPeriod < 2.1)
  assert.ok(exitEnd.dronePitch > 1.7)
  assert.ok(exitEnd.droneCutoff > 2400)

  // 4. Leave (0.5s): cool tint sweeps out to the right, everything restores cleanly to idle
  machine.leave()
  const leaveStarts = []
  let leftFired = 0
  let finalState = null
  for (let i = 0; i < 32; i++) {
    const { state, events } = machine.step(dt, { inFlow: false, remaining: 0 })
    if (events.left)
      leftFired++
    if (state.phase === 'leave')
      leaveStarts.push(state.screen.sweepStart)
    finalState = state
  }
  assert.equal(leftFired, 1)
  assert.ok(leaveStarts[0] < 0.05 && leaveStarts.at(-1) > 0.9, 'leave sweeps tint out to the right')
  assert.equal(finalState.phase, 'idle')
  assert.equal(finalState.screen.active, 0)
  assert.equal(finalState.timeScale, 1)
  assert.equal(finalState.blurPx, 0)
  assert.equal(finalState.fovOffset, 0)
  assert.equal(finalState.enemyGlow, 0)
})

test('kill extension during exit reverses blur, timeScale, tick/breath pace, and drone smoothly without jumping', () => {
  const machine = new FlowStateMachine()
  const dt = 1 / 60
  machine.enter()
  for (let i = 0; i < 50; i++)
    machine.step(dt, { inFlow: true, remaining: 4.5 })
  // Advance deep into exit (remaining = 0.5s -> exitIntensity ~0.8)
  let beforeExtend = null
  for (let i = 0; i < 120; i++) {
    const rem = Math.max(0.5, 2.5 - i * dt)
    beforeExtend = machine.step(dt, { inFlow: true, remaining: rem }).state
  }
  assert.ok(beforeExtend.blurPx > 2.0)
  assert.ok(beforeExtend.timeScale > 0.75)

  // Kill extends remaining sharply from 0.5s -> 2.8s!
  let prev = beforeExtend
  let maxBlurJump = 0
  let maxScaleJump = 0
  let maxPitchJump = 0
  for (let i = 0; i < 90; i++) {
    const next = machine.step(dt, { inFlow: true, remaining: 2.8 }).state
    maxBlurJump = Math.max(maxBlurJump, Math.abs(next.blurPx - prev.blurPx))
    maxScaleJump = Math.max(maxScaleJump, Math.abs(next.timeScale - prev.timeScale))
    maxPitchJump = Math.max(maxPitchJump, Math.abs(next.dronePitch - prev.dronePitch))
    prev = next
  }
  assert.ok(maxBlurJump < 0.25, `blur retracted smoothly without jumping (max step ${maxBlurJump})`)
  assert.ok(maxScaleJump < 0.08, `timeScale retracted smoothly without jumping (max step ${maxScaleJump})`)
  assert.ok(maxPitchJump < 0.08, `drone pitch retracted smoothly without jumping (max step ${maxPitchJump})`)
  assert.ok(prev.blurPx < 0.05, 'blur fully recovered after sustained extension')
  assert.ok(Math.abs(prev.timeScale - 0.25) < 0.02, 'timeScale smoothly returned to 0.25x')
  assert.ok(prev.tickInterval > 0.96, 'tick interval smoothly relaxed back toward 1.0s')
  assert.ok(prev.breathPeriod > 4.2, 'breath period smoothly relaxed back toward 4.4s')
})

test('ParticleSystem honors world timeScale so particles slow to 0.25x and accelerate back smoothly', () => {
  const scene = new THREE.Scene()
  const system = createParticleSystem({ scene, capacity: 4 })
  system.flush({ presentationTime: 1 })
  system.setTimeScale(0.25)
  system.emit([
    {
      shape: 'cube',
      born: 1,
      life: 1,
      origin: [0, 0, 0],
      velocity: [0, 0, 0],
      color: [1, 1, 1],
      size: 0.2,
      gravity: 0,
    },
  ])
  // After 2.0 real seconds at 0.25x, only 0.5 world seconds elapsed -> particle still alive!
  system.flush({ presentationTime: 3 })
  assert.equal(system.snapshot().alive, 1)

  // Return to 1.0x and advance 0.6 more real seconds -> total 1.1 world seconds -> particle expires!
  system.setTimeScale(1)
  system.flush({ presentationTime: 3.6 })
  assert.equal(system.snapshot().alive, 0)
  system.dispose()
})

test('FlowAudio loads /audio/zoom samples, releases raw bg binary, plays cues with correct offsets, and slows BGM by worldDt', async (t) => {
  const context = new FlowFakeAudioContext()
  context.durations.set(1, 4.0) // in.wav
  context.durations.set(2, 2.0) // out.wav
  context.durations.set(3, 0.308) // tick.wav
  context.durations.set(4, 0.123) // tick2.wav
  context.durations.set(5, 13.0) // breath.wav
  context.durations.set(6, 120.0) // bg.wav

  const audio = new AudioSystem({ context })
  t.after(() => audio.dispose())
  await audio.unlock()

  const tags = {
    in: 1,
    out: 2,
    tick: 3,
    tick2: 4,
    breath: 5,
    bg: 6,
  }
  const binary = new Map()
  const unloaded = []
  const resources = {
    async load([entry]) {
      const key = entry.name.split(':').at(-1)
      const bytes = new ArrayBuffer(4)
      new Uint8Array(bytes)[0] = tags[key]
      binary.set(entry.name, bytes)
    },
    get: name => binary.get(name),
    unload(name) {
      unloaded.push(name)
      binary.delete(name)
    },
  }

  const flowAudio = new FlowAudio({ audio, resources })
  t.after(() => flowAudio.dispose())
  await flowAudio.ready

  assert.equal(flowAudio.sampleCount, 6)
  assert.ok(unloaded.some(name => name.endsWith(':bg')), '46MB bg.wav raw binary is released immediately after decode')

  // Trigger enter (step 0.1s so enter SFX starts immediately and drone bed fades in)
  const machine = new FlowStateMachine()
  machine.enter()
  let step1 = null
  for (let i = 0; i < 6; i++) {
    step1 = machine.step(1 / 60, { inFlow: true, remaining: 5 - i / 60 })
    flowAudio.update(step1.state, step1.events, { worldDt: 1 / 60, trialActive: true })
  }

  // Verify enter cue starts at offset 0.45s and looping bg drone starts
  const inSource = context.sources.find(s => s.buffer?.tag === 1)
  const bgSource = context.sources.find(s => s.buffer?.tag === 6)
  assert.ok(inSource, 'in.wav played on enter')
  assert.ok(Math.abs(inSource.starts[0].offset - 0.45) < 1e-6, 'in.wav skips 0.45s leading silence')
  assert.ok(bgSource?.loop, 'bg.wav loops as drone bed')

  // Trigger alternating ticks + inhale/exhale manually through update
  flowAudio.update(
    {
      ...step1.state,
      phase: 'flow',
      timeScale: 0.25,
      exitIntensity: 0,
      breathPeriod: 4.4,
      droneGain: 0.24,
      dronePitch: 1,
      droneCutoff: 260,
      worldLowpass: 2200,
      bgmCutoff: 380,
    },
    {
      entered: false,
      left: false,
      tick: 'high',
      breath: 'inhale',
    },
    { worldDt: 0.05, trialActive: true },
  )
  flowAudio.update(
    {
      ...step1.state,
      phase: 'exit',
      timeScale: 0.85,
      exitIntensity: 0.85,
      breathPeriod: 2.2,
      droneGain: 0.32,
      dronePitch: 1.72,
      droneCutoff: 2400,
      worldLowpass: 9000,
      bgmCutoff: 1600,
    },
    {
      entered: false,
      left: false,
      tick: 'low',
      breath: 'exhale',
    },
    { worldDt: 0.25, trialActive: true },
  )

  const tickHigh = context.sources.find(s => s.buffer?.tag === 3)
  const tickLow = context.sources.find(s => s.buffer?.tag === 4)
  assert.ok(tickHigh && Math.abs(tickHigh.starts[0].offset - 0.105) < 1e-6, 'tick.wav trims 0.105s leading silence')
  assert.ok(tickLow && tickLow.starts[0].offset === 0, 'tick2.wav starts at 0')

  const breaths = context.sources.filter(s => s.buffer?.tag === 5)
  assert.equal(breaths.length, 2)
  assert.ok(Math.abs(breaths[0].starts[0].offset - 4.35) < 1e-6, 'inhale uses lighter breath region')
  assert.ok(Math.abs(breaths[1].starts[0].offset - 0.85) < 1e-6, 'exhale uses deeper heavier breath region')
  assert.ok(bgSource.playbackRate.value > 1.6, 'drone pitch rises during exit')
  assert.ok(context.oscillators.length >= 2, 'BGM arpeggio and exit tension shimmer synthesize cleanly')

  // Verify BGM arpeggio steps 4x slower when worldDt = realDt * 0.25
  const oscBeforeNormal = context.oscillators.length
  for (let i = 0; i < 60; i++) {
    flowAudio.update({
      ...step1.state,
      phase: 'idle',
      timeScale: 1,
      exitIntensity: 0,
      droneGain: 0,
      bgmCutoff: 2400,
      worldLowpass: 20000,
    }, {
      entered: false,
      left: false,
      tick: null,
      breath: null,
    }, { worldDt: 1 / 60, trialActive: true })
  }
  const normalNotes = context.oscillators.length - oscBeforeNormal

  const oscBeforeFlow = context.oscillators.length
  for (let i = 0; i < 60; i++) {
    flowAudio.update({
      ...step1.state,
      phase: 'flow',
      timeScale: 0.25,
      exitIntensity: 0,
      droneGain: 0.24,
      dronePitch: 1,
      droneCutoff: 260,
      bgmCutoff: 380,
      worldLowpass: 2200,
    }, {
      entered: false,
      left: false,
      tick: null,
      breath: null,
    }, { worldDt: (1 / 60) * 0.25, trialActive: true })
  }
  const flowNotes = context.oscillators.length - oscBeforeFlow
  assert.ok(normalNotes >= 3 && flowNotes <= 1, `BGM arpeggio slowed in Flow: normal=${normalNotes}, flow=${flowNotes}`)

  // Leave plays out.wav
  flowAudio.update({ ...step1.state, phase: 'leave', droneGain: 0.1 }, {
    entered: false,
    left: true,
    tick: null,
    breath: null,
  }, { worldDt: 0, trialActive: false })
  const outSource = context.sources.find(s => s.buffer?.tag === 2)
  assert.ok(outSource && outSource.starts[0].offset === 0, 'out.wav played on leave')
})

test('FlowEffectComponent drives render, camera FOV offset, enemy glow, and particles; buildPipeline accepts flowEffect', () => {
  const camera = new THREE.PerspectiveCamera(90, 16 / 9, 0.1, 100)
  const rig = new GameObject({ name: 'Player' })
  rig.addComponent(new TransformComponent())
  const cameraComponent = rig.addComponent(new CameraComponent({
    camera,
    sampleViewPose: () => ({
      worldFov: 90,
      position: [0, 1.6, 0],
      quaternion: [0, 0, 0, 1],
    }),
  }))

  let latestScreen = null
  let latestGlow = 0
  let latestParticleScale = 1
  const trial = { inFlow: true, remaining: 5.0 }
  const challenge = { trial, running: true }

  const flow = new FlowEffectComponent({
    challenge,
    player: { cameraComponent },
    render: {
      setFlowEffect: (next) => { latestScreen = { ...next } },
      resetFlowEffect: () => { latestScreen = { active: 0 } },
    },
    particles: {
      setTimeScale: (scale) => { latestParticleScale = scale },
    },
    botAssets: {
      setFlowGlow: (value) => { latestGlow = value },
    },
  })

  flow.onFlowEvent('flow_enter')
  for (let i = 0; i < 48; i++) {
    trial.remaining -= 1 / 60
    flow.tick({
      time: { rawDelta: 1 / 60, timeScale: 1 },
    })
  }
  assert.ok(Math.abs(flow.worldTimeScale - 0.25) < 0.02)
  assert.ok(Math.abs(latestParticleScale - 0.25) < 0.02)
  assert.ok(latestGlow > 0.9)
  assert.equal(latestScreen.active, 1)

  cameraComponent.tick({
    time: { presentationTime: 1 },
  })
  assert.ok(camera.fov < 84, `camera FOV narrowed during Flow (got ${camera.fov})`)

  // Cancel resets everything immediately
  flow.onFlowEvent('flow_exit', 'cancelled')
  assert.equal(flow.worldTimeScale, 1)
  assert.equal(latestParticleScale, 1)
  assert.equal(latestGlow, 0)
  assert.equal(latestScreen.active, 0)
  cameraComponent.tick({
    time: { presentationTime: 1.1 },
  })
  assert.equal(camera.fov, 90)
  flow.dispose()
  rig.dispose()

  // Verify TSL post-processing pipeline builds cleanly with flowEffect
  const scene = new THREE.Scene()
  const flowEffect = createFlowEffectState(new THREE.Data3DTexture())
  const fakeRenderer = { coordinateSystem: THREE.WebGPUCoordinateSystem }
  const built = buildPipeline(fakeRenderer, scene, camera, {
    aa: 'none',
    ao: false,
    aoView: 'scene',
    lut: false,
    colorGrading: false,
  }, null, null, flowEffect)
  assert.equal(typeof built.render, 'function')
  assert.equal(typeof built.dispose, 'function')
  flowEffect.set({
    active: 1,
    sweepStart: -0.1,
    sweepEnd: 0.6,
    edgeX: 0.6,
    edgeIntensity: 0.85,
    tintStrength: 1,
    vignette: 0.55,
    blurPx: 2.1,
  })
  assert.equal(flowEffect.snapshot().blurPx, 2.1)
  flowEffect.reset()
  assert.equal(flowEffect.snapshot().active, 0)
  built.dispose()
  flowEffect.lutTexture.dispose()
})
