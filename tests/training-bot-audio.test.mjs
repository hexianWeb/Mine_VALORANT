import assert from 'node:assert/strict'
import test from 'node:test'
import { AudioSystem } from '../src/engine/runtime/function/audio/audio-system.js'
import { TrainingBotAudio } from '../src/game/targets/training-bot-audio.js'
import { audioTime, FakeAudioContext, h } from './audio-fixture.mjs'

function setup(t, { fail = null, decode = null, signal } = {}) {
  const context = new FakeAudioContext()
  const warnings = []
  const audio = new AudioSystem({
    context,
    onWarning: warning => warnings.push(warning),
  })
  const enqueue = t.mock.method(audio, 'enqueue')
  if (decode)
    t.mock.method(audio, 'decode', decode)
  const loaded = new Map()
  const requests = []
  const unloaded = []
  const resources = {
    async load([entry], { signal } = {}) {
      signal?.throwIfAborted()
      requests.push(entry)
      if (entry.url === fail)
        throw new Error('Missing hit sample')
      loaded.set(entry.name, new ArrayBuffer(4))
    },
    get(name) { return loaded.get(name) },
    unload(name) {
      unloaded.push(name)
      loaded.delete(name)
    },
  }
  const bank = new TrainingBotAudio({ audio, resources, signal })
  t.after(() => {
    bank.dispose()
    audio.dispose()
  })
  return {
    bank,
    audio,
    context,
    enqueue,
    warnings,
    loaded,
    requests,
    unloaded,
  }
}

test('hit sounds preload once and schedule on the shared audio clock with per-owner cleanup', async (t) => {
  const { bank, audio, context, enqueue, requests } = setup(t)
  assert.equal(bank.play({
    owner: 'a',
    region: 'head',
    sequence: 1,
    at: h,
  }), false)
  await bank.ready
  assert.equal(bank.sampleCount, 4)
  assert.deepEqual(requests.map(entry => entry.url), [
    '/audio/bot/Body_Hit.ogg',
    '/audio/bot/Head_Hit.ogg',
    '/audio/bot/botIn.ogg',
    '/audio/bot/botOut.ogg',
  ])
  assert.equal(context.decoded.length, 4)
  assert.equal(enqueue.mock.callCount(), 0, 'hits before readiness are never replayed')
  await audio.unlock()
  audio.flush(audioTime(0, 0))
  bank.play({
    owner: 'a',
    region: 'head',
    sequence: 2,
    at: h,
  })
  bank.play({
    owner: 'b',
    region: 'chest',
    sequence: 1,
    at: h,
  })
  audio.flush(audioTime(1, h))
  const cues = enqueue.mock.calls.map(call => call.arguments[0])
  assert.deepEqual(cues.map(cue => cue.group), ['bot-hit:head', 'bot-hit:body'])
  assert.deepEqual(cues.map(cue => cue.gain), [0.28, 0.28])
  assert.notEqual(cues[0].buffer, cues[1].buffer)
  assert.equal(context.sources.length, 2)
  assert.ok(context.sources.every(source => source.starts[0].offset === 0))
  assert.ok(context.sources.every(source => source.starts[0].rate === 0.85), 'both hit sounds play at a lower pitch')
  assert.ok(audio.snapshot().cues.every(cue => cue.state === 'scheduled'))
  bank.stop('a')
  assert.equal(context.sources.find(source => source.buffer === cues[0].buffer).stops.length, 1)
  assert.equal(context.sources.find(source => source.buffer === cues[1].buffer).stops.length, 0)
  assert.deepEqual(audio.snapshot().cues.map(cue => cue.owner), ['b'])
})

test('a missing head sample does not disable body sounds or reject visual loading', async (t) => {
  const { bank, warnings, enqueue } = setup(t, { fail: '/audio/bot/Head_Hit.ogg' })
  await bank.ready
  assert.equal(bank.sampleCount, 3)
  assert.equal(warnings.length, 1)
  assert.equal(bank.play({
    owner: 'a',
    region: 'head',
    sequence: 1,
    at: h,
  }), false)
  assert.equal(bank.play({
    owner: 'a',
    region: 'arm_l',
    sequence: 2,
    at: h,
  }), true)
  assert.equal(enqueue.mock.callCount(), 1)
  assert.equal(enqueue.mock.calls[0].arguments[0].group, 'bot-hit:body')
  assert.equal(bank.play({ owner: 'a', region: 'chest', sequence: 3 }), false, 'untimed hits are not scheduled')
})

test('disposing during decode releases resources and never resurrects buffers or cues', async (t) => {
  const pending = Promise.withResolvers()
  const { bank, audio, loaded, unloaded, warnings, enqueue } = setup(t, {
    decode: () => pending.promise,
  })
  await Promise.resolve()
  assert.equal(audio.decode.mock.callCount(), 4)
  bank.dispose()
  bank.dispose()
  assert.equal(loaded.size, 0)
  assert.equal(unloaded.length, 4)
  pending.resolve({ duration: 1 })
  await bank.ready
  assert.equal(bank.sampleCount, 0)
  assert.equal(warnings.length, 0)
  assert.equal(bank.play({
    owner: 'a',
    region: 'head',
    sequence: 1,
    at: h,
  }), false)
  assert.equal(enqueue.mock.callCount(), 0)
})

test('aborting during decode keeps late samples silent without warnings', async (t) => {
  const controller = new AbortController()
  const pending = Promise.withResolvers()
  const { bank, warnings, enqueue } = setup(t, {
    signal: controller.signal,
    decode: () => pending.promise,
  })
  await Promise.resolve()
  controller.abort()
  pending.resolve({ duration: 1 })
  await bank.ready
  assert.equal(bank.sampleCount, 0)
  assert.equal(warnings.length, 0)
  assert.equal(enqueue.mock.callCount(), 0)
})
