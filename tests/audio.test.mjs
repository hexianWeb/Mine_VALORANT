import assert from 'node:assert/strict'
import test from 'node:test'
import { Time } from '../src/engine/runtime/core/time.js'
import { Engine } from '../src/engine/runtime/engine.js'
import { AudioSystem } from '../src/engine/runtime/function/audio/audio-system.js'
import { PlayerFootsteps } from '../src/game/player/player-footsteps.js'
import { audioTime, cue, FakeAudioContext, h } from './audio-fixture.mjs'

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`)

async function setup(t, options = {}) {
  const context = new FakeAudioContext()
  const warnings = []
  const audio = new AudioSystem({
    context,
    onWarning: warning => warnings.push(warning),
    ...options,
  })
  t.after(() => audio.dispose())
  await audio.unlock()
  audio.flush(audioTime(0, 0))
  return { context, audio, warnings }
}

test('canvas unlocks audio only in the activation event for each input type', (t) => {
  const element = new EventTarget()
  const audio = new AudioSystem({ element })
  t.after(() => audio.dispose())
  const unlock = t.mock.method(audio, 'unlock', async () => true)
  const dispatch = (type, pointerType, isTrusted = true) => {
    const event = new Event(type)
    Object.defineProperties(event, {
      pointerType: { value: pointerType },
      isTrusted: { value: isTrusted },
    })
    element.dispatchEvent(event)
  }

  for (const pointerType of ['touch', 'pen', 'mouse']) {
    const before = unlock.mock.callCount()
    dispatch('pointerdown', pointerType)
    assert.equal(unlock.mock.callCount(), before + Number(pointerType === 'mouse'))
    dispatch('pointerup', pointerType)
    assert.equal(unlock.mock.callCount(), before + 1)
  }
  dispatch('keydown')
  assert.equal(unlock.mock.callCount(), 4)
  dispatch('pointerup', 'touch', false)
  assert.equal(unlock.mock.callCount(), 4)
})

test('footsteps enqueue on distance crossings, rotate buffers, and invalidate on respawn', async (t) => {
  const { audio } = await setup(t)
  const binary = new Map()
  const footsteps = new PlayerFootsteps({
    audio,
    resources: {
      async load([entry]) { binary.set(entry.name, new ArrayBuffer(1)) },
      get: name => binary.get(name),
      unload: name => binary.delete(name),
    },
  })
  t.after(() => footsteps.dispose())
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(footsteps.sampleCount, 5)

  const enqueue = t.mock.method(audio, 'enqueue')
  footsteps.advance(0.8, 1.2, audioTime(1, h), false)
  footsteps.advance(1.2, 1.9, audioTime(2, 2 * h), false)
  footsteps.advance(1.9, 2.3, audioTime(3, 3 * h), true)
  const emitted = enqueue.mock.calls.map(call => call.arguments[0])
  assert.equal(emitted.length, 2)
  close(emitted[0].at, h / 2)
  close(emitted[1].at, 2.25 * h)
  assert.notEqual(emitted[0].buffer, emitted[1].buffer)
  assert.ok(emitted[1].gain < emitted[0].gain)

  footsteps.reset()
  assert.equal(audio.snapshot().cues.filter(cue => cue.state === 'queued').length, 0)
  footsteps.advance(0.9, 1.1, audioTime(4, 4 * h), false)
  assert.notEqual(enqueue.mock.calls.at(-1).arguments[0].id, emitted[0].id)
})

for (const steps of [1, 2, 5]) {
  test(`${steps}-step delivery preserves absolute spacing and drops only expired transient deadlines`, async (t) => {
    const { context, audio } = await setup(t)
    context.advance(steps * h)
    for (let index = 1; index <= steps; index++) audio.enqueue(cue(`shot-${index}`, index * h))
    audio.flush(audioTime(1, steps * h))
    const kept = context.sources.flatMap(source => source.starts.map(start => start.when))
    const expected = steps === 5
      ? [4 * h + h + 0.01, 5 * h + h + 0.01]
      : Array.from({ length: steps }, (_, index) => (index + 2) * h + 0.01)
    assert.equal(kept.length, expected.length)
    kept.forEach((at, index) => close(at, expected[index]))
    assert.equal(audio.snapshot().stats.missedDeadlines, steps === 5
      ? 3
      : 0)
    assert.equal(audio.snapshot().segments.length, 1, 'ordinary batches never reanchor')
  })
}

test('an opted-in late transient only plays while its simulation event is fresh', async (t) => {
  const { audio, context } = await setup(t)
  context.advance(6 * h)
  audio.enqueue(cue('strict-shot', 4.3 * h))
  audio.enqueue(cue('fresh-step', 4.3 * h, { lateWindow: 0.05 }))
  audio.enqueue(cue('stale-step', 2 * h, { lateWindow: 0.05 }))
  audio.flush(audioTime(1, 6 * h))

  const states = Object.fromEntries(audio.snapshot().cues.map(event => [event.id, event.state]))
  assert.deepEqual(states, {
    'strict-shot': 'dropped',
    'fresh-step': 'scheduled',
    'stale-step': 'dropped',
  })
  assert.equal(context.sources.length, 1)
  close(context.sources[0].starts[0].when, 6 * h + audio.lead)
})

test('250 ms clipping discards the old batch then reanchors subsequent facts, without shifting old shots', async (t) => {
  const { context, audio } = await setup(t)
  const time = new Time()
  time.tick(0)
  context.advance(0.25)
  time.tick(250)
  for (let step = 0; step < time.fixedSteps; step++) {
    time.completeFixedStep(step)
    audio.enqueue(cue(`old-${step}`, time.fixedElapsed))
  }
  const snapshot = time.snapshot()
  close(snapshot.unclippedDelta, 0.25)
  close(snapshot.clippedWallTime + snapshot.droppedSimulationTime, 1 / 6)
  audio.flush(snapshot)
  assert.equal(audio.snapshot().stats.missedDeadlines, 5)
  assert.equal(context.sources.length, 0)
  assert.equal(audio.snapshot().segments.at(-1).reason, 'wall-clock-clipped')
  context.advance(0.25 + h)
  audio.enqueue(cue('new', 6 * h))
  audio.flush(audioTime(3, 6 * h))
  close(context.sources[0].starts[0].when, 0.293333333333)
})

for (const [field, reason] of [
  ['clippedWallTime', 'wall-clock-clipped'],
  ['droppedSimulationTime', 'fixed-time-dropped'],
]) {
  test(`${reason} keeps freshly confirmed local sounds and discards the previous-frame batch`, async (t) => {
    const { audio, context } = await setup(t)
    context.advance(2 * h)
    audio.flush(audioTime(1, 2 * h))
    context.advance(0.24)

    audio.enqueue(cue('old-step', h, { lateWindow: 0.1 }))
    audio.enqueue(cue('current-shot', 3 * h, { lateWindow: 0.1 }))
    audio.enqueue(cue('current-step', 6.5 * h, { lateWindow: 0.1 }))
    audio.enqueue(cue('strict-transient', 7 * h))
    audio.flush(audioTime(2, 7 * h, { [field]: h }))

    const snapshot = audio.snapshot()
    assert.equal(snapshot.segments.at(-1).reason, reason)
    assert.deepEqual(Object.fromEntries(snapshot.cues.map(event => [event.id, event.state])), {
      'old-step': 'dropped',
      'current-shot': 'scheduled',
      'current-step': 'scheduled',
      'strict-transient': 'dropped',
    })
    assert.equal(context.sources.length, 2)
    close(context.sources[0].starts[0].when, 0.24 + audio.lead)
  })
}

test('overlapping shots use independent sources, semantic deduplication and a bounded tail budget', async (t) => {
  const { context, audio } = await setup(t, { maxVoices: 2 })
  for (let index = 1; index <= 4; index++) {
    context.advance(index * 0.1)
    const shot = cue(`shot-${index}`, index * 0.1)
    assert.equal(audio.enqueue(shot), true)
    assert.equal(audio.enqueue(shot), false)
    audio.flush(audioTime(index, index * 0.1))
    assert.ok(audio.snapshot().activeVoices <= 2)
  }
  assert.equal(context.sources.length, 4)
  assert.equal(audio.snapshot().stats.dropped, 2)
  assert.equal(context.sources[0].stops.length, 1)
  assert.ok(context.gains.some(gain => gain.gain.events.some(event => event.type === 'ramp')))
  context.advance(3)
  audio.flush(audioTime(5, 3))
  assert.equal(audio.snapshot().voices, 0)
})

test('action cancellation maps to its confirmed time, fades only the action and preserves shot tails', async (t) => {
  const { context, audio } = await setup(t)
  audio.enqueue(cue('reload', h, { kind: 'action', actionId: 'reload:1', endAt: 2 }))
  audio.enqueue(cue('shot', h))
  context.advance(h)
  audio.flush(audioTime(1, h))
  context.advance(0.1)
  audio.cancelAction({
    scope: 'level',
    owner: 'player',
    epoch: 1,
    group: 'gun',
    at: 0.12,
  })
  audio.flush(audioTime(2, 0.1))
  close(context.sources[0].stops[0], 0.12 + h + 0.01 + 0.008)
  assert.equal(context.sources[1].stops.length, 0)
  audio.invalidate({ scope: 'level', owner: 'player' })
  assert.equal(audio.snapshot().voices, 0)
  assert.ok(context.sources.every(source => source.disconnected))
})

test('late action audio resumes at its correct offset, but cannot resurrect after cancellation', async (t) => {
  const { context, audio } = await setup(t)
  context.advance(0.5)
  audio.enqueue(cue('inspect', 0.1, { kind: 'action', actionId: 'inspect:1', endAt: 2 }))
  audio.flush(audioTime(1, 0.5))
  close(context.sources[0].starts[0].offset, 0.5 + 0.006 - (0.1 + h + 0.01))
  audio.cancelAction({
    scope: 'level',
    owner: 'player',
    epoch: 1,
    actionId: 'inspect:1',
    at: 0.3,
  })
  audio.flush(audioTime(2, 0.5))
  context.advance(0.6)
  audio.flush(audioTime(3, 0.6, { timeScale: 2 }))
  assert.equal(context.sources.length, 1)
})

test('positive scale changes rebuild pending cues under the same IDs, while started shot tails keep pitch', async (t) => {
  const { context, audio } = await setup(t)
  context.advance(h)
  audio.enqueue(cue('tail', h))
  audio.enqueue(cue('action', h, { kind: 'action', actionId: 'reload:1', endAt: 2 }))
  audio.flush(audioTime(1, h))
  context.advance(0.1)
  audio.enqueue(cue('pending', 0.1))
  audio.flush(audioTime(2, 0.1))
  context.advance(0.102)
  audio.flush(audioTime(3, 0.1, { timeScale: 2 }))
  assert.equal(context.sources[0].stops.length, 0)
  assert.equal(context.sources[0].playbackRate.value, 1)
  assert.equal(audio.snapshot().cues.filter(record => record.id === 'action').length, 1)
  assert.equal(audio.snapshot().cues.find(record => record.id === 'action').playbackRate, 2)
  const pending = audio.snapshot().cues.find(record => record.id === 'pending')
  close(pending.audioAt, 0.102 + h / 2 + 0.01)
  assert.equal(pending.state, 'scheduled')
})

test('locked and paused frames never replay historical shots; decode does not detach shared bytes', async (t) => {
  const context = new FakeAudioContext()
  const audio = new AudioSystem({ context })
  t.after(() => audio.dispose())
  const bytes = new ArrayBuffer(12)
  await audio.decode(bytes)
  assert.equal(bytes.byteLength, 12)
  assert.equal(context.decoded[0].byteLength, 0)
  audio.enqueue(cue('locked', 0))
  audio.flush(audioTime(0, 0))
  await audio.unlock()
  audio.flush(audioTime(1, 0))
  assert.equal(context.sources.length, 0)
  audio.enqueue(cue('future', h))
  audio.flush(audioTime(2, h))
  audio.setPaused(true)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(context.state, 'suspended')
  await audio.unlock()
  assert.equal(context.state, 'suspended', 'a trusted click must not resume already-unlocked audio while the game is paused')
  audio.enqueue(cue('paused', 2 * h))
  audio.flush(audioTime(3, h))
  audio.setPaused(false)
  await new Promise(resolve => setImmediate(resolve))
  audio.flush(audioTime(4, h, { clockRevision: 1 }))
  assert.equal(audio.snapshot().cues.find(record => record.id === 'paused').state, 'dropped')
  assert.equal(audio.snapshot().cues.find(record => record.id === 'future').state, 'dropped')
  audio.flush(audioTime(5, h, { timeScale: 0, clockRevision: 1 }))
  assert.equal(audio.snapshot().paused, true)
  assert.ok(Number.isFinite(audio.snapshot().anchor.rate))
})

test('failed unlock warns once, unsupported audio remains optional, and repeated disposal closes everything', async () => {
  const context = new FakeAudioContext()
  context.resumeFailure = new Error('denied')
  const warnings = []
  const audio = new AudioSystem({
    context,
    onWarning: warning => warnings.push(warning),
  })
  assert.equal(await audio.unlock(), false)
  assert.equal(await audio.unlock(), false)
  assert.equal(warnings.length, 1)
  audio.dispose()
  audio.dispose()
  assert.equal(context.state, 'closed')
  assert.equal(await audio.unlock(), false)
  const unavailable = new AudioSystem({
    createContext: () => { throw new Error('unsupported') },
    onWarning() {},
  })
  assert.equal(await unavailable.unlock(), false)
  assert.equal(unavailable.snapshot().state, 'unavailable')
  unavailable.dispose()
})

test('Engine flushes audio once after presentation with the final listener, never in rendererTick', () => {
  const calls = []
  let position = [0, 0, 0]
  const engine = new Engine({
    world: {
      tickComponents(phase) {
        calls.push(phase)
        if (phase === 'presentation')
          position = [1, 2, 3]
      },
    },
    audio: {
      flush(time, listener) {
        calls.push('audio')
        assert.deepEqual(listener.position, [1, 2, 3])
      },
      invalidate() {},
    },
    listener: () => ({
      position,
      quaternion: [0, 0, 0, 1],
    }),
    render: {
      update() { calls.push('render') },
    },
  })
  engine.step(0)
  engine.rendererTick()
  engine.rendererTick()
  assert.deepEqual(calls, [
    'input',
    'motion',
    'presentation',
    'audio',
    'render',
    'render',
    'render',
  ])
  engine.destroy()
})

test('real fixed Time produces identical scheduled shot times at 30/60/144 FPS without ordinary reanchoring', async (t) => {
  const schedules = []
  for (const fps of [30, 60, 144]) {
    const { audio, context } = await setup(t)
    const time = new Time()
    time.tick(0)
    for (let frame = 1; frame <= fps * 2; frame++) {
      context.advance(frame / fps)
      time.tick(frame * 1000 / fps)
      for (let step = 0; step < time.fixedSteps; step++) {
        time.completeFixedStep(step)
        if (time.fixedTick % 6 === 0)
          audio.enqueue(cue(`shot-${time.fixedTick}`, time.fixedElapsed))
      }
      audio.flush(time.snapshot())
    }
    const starts = context.sources.map(source => source.starts[0].when)
    assert.equal(starts.length, 20)
    assert.equal(audio.snapshot().segments.length, 1)
    assert.equal(audio.snapshot().stats.missedDeadlines, 0)
    schedules.push(starts)
  }
  for (let index = 0; index < 20; index++) {
    close(schedules[0][index], schedules[1][index])
    close(schedules[1][index], schedules[2][index])
  }
})

test('wall-clock loss fades a playing long action and rebuilds the same cue at the new correct offset', async (t) => {
  const { audio, context } = await setup(t)
  audio.enqueue(cue('inspect', 0, { kind: 'action', actionId: 'inspect:1', endAt: 2 }))
  audio.flush(audioTime(1, 0))
  context.advance(0.25)
  audio.flush(audioTime(2, 5 * h, { clippedWallTime: 0.15, droppedSimulationTime: h }))
  assert.equal(context.sources.length, 2)
  close(context.sources[1].starts[0].offset, 5 * h - h - 0.01 + 0.006)
  assert.equal(audio.snapshot().cues.filter(record => record.id === 'inspect').length, 1)
  assert.equal(audio.snapshot().stats.rebuilt, 1)
  audio.enqueue(cue('no-resume', 0, { kind: 'action', endAt: 2, resume: false }))
  audio.flush(audioTime(3, 5 * h))
  assert.equal(audio.snapshot().cues.find(record => record.id === 'no-resume').reason, 'action-not-resumable')
})

test('interruption immediately revokes future shots, before any resume/flush can make them audible', async (t) => {
  const { audio, context } = await setup(t)
  audio.enqueue(cue('future', h))
  audio.flush(audioTime(1, h))
  context.state = 'interrupted'
  context.dispatchEvent(new Event('statechange'))
  assert.equal(audio.snapshot().voices, 0)
  await audio.unlock()
  audio.flush(audioTime(2, h))
  assert.equal(context.sources.length, 1)
  assert.equal(audio.snapshot().cues.find(record => record.id === 'future').state, 'dropped')
})
