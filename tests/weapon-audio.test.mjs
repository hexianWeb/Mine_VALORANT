import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { AudioSystem } from '../src/engine/runtime/function/audio/audio-system.js'
import { loaders } from '../src/engine/runtime/resource/loader/loaders.js'
import { ResourceManager } from '../src/engine/runtime/resource/resource-manager.js'
import { WeaponAssets } from '../src/game/weapons/assets/weapon-assets.js'
import { weaponAudioProfiles } from '../src/game/weapons/definitions/audio.js'
import { classicDefinition } from '../src/game/weapons/definitions/classic.js'
import { WeaponAudio } from '../src/game/weapons/weapon-audio.js'
import { audioTime, cue, FakeAudioContext, h } from './audio-fixture.mjs'

test('all configured local sound inputs match the supplied Ogg files; reload aliases share one cue', async () => {
  for (const profile of Object.values(weaponAudioProfiles)) {
    assert.equal(profile.reloadEmpty, profile.reloadTactical)
    for (const descriptor of Object.values(profile.cues)) {
      const bytes = await readFile(`public${descriptor.url}`)
      assert.equal(bytes.subarray(0, 4).toString(), 'OggS')
      assert.equal(createHash('sha256').update(bytes).digest('hex'), descriptor.sha256)
      assert.ok(descriptor.gain < 0.5)
    }
  }
})

test('AudioBank coalesces decoding and preserves successful siblings on failure; retries reuse shared bytes', async (t) => {
  const resources = new ResourceManager()
  const context = new FakeAudioContext()
  const audio = new AudioSystem({
    context,
    onWarning() {},
  })
  const calls = []
  t.mock.method(loaders, 'binary', async (entry) => {
    calls.push(entry)
    return new ArrayBuffer(16)
  })
  const assets = new WeaponAssets({ resources, audio, scopeId: 'bank-test' })
  t.after(() => {
    assets.dispose()
    audio.dispose()
    resources.dispose()
  })
  const profile = weaponAudioProfiles.classic
  await Promise.all([
    assets.preloadAudio(profile),
    assets.preloadAudio(profile),
  ])
  assert.equal(calls.length, 4)
  assert.equal(context.decoded.length, 4)
  assert.equal(assets.audioSnapshot().cues, 4)
  assert.equal(assets.audioSnapshot().decodedBytes, 4 * 48000 * 2 * 4)
  for (const entry of calls) assert.equal(resources.get(entry.name, 'binary').byteLength, 16)
  await audio.unlock()
  audio.flush(audioTime(0, 0))
  audio.enqueue(cue('bank-voice', h, { scope: assets.audioScope, buffer: assets.audioCue(profile.fire).buffer }))
  audio.flush(audioTime(1, h))
  const unload = resources.unload.bind(resources)
  t.mock.method(resources, 'unload', (name) => {
    assert.equal(audio.snapshot().voices, 0, 'scope voices stop before releasing shared bytes/bank')
    unload(name)
  })
  assets.dispose()
  assert.equal(assets.audioSnapshot().cues, 0)
  assert.ok(calls.every(entry => !resources.has(entry.name)))
})

test('a failed decode can retry without re-downloading siblings and a late decode cannot reopen a closed scope', async (t) => {
  const resources = new ResourceManager()
  let downloads = 0
  t.mock.method(loaders, 'binary', async () => {
    downloads++
    return new ArrayBuffer(4)
  })
  let decodes = 0
  const delayed = Promise.withResolvers()
  const errors = []
  const audio = {
    async decode() {
      decodes++
      if (decodes === 1)
        throw new Error('decode failed')
      if (decodes === 3)
        return delayed.promise
      return { duration: 1, length: 10, numberOfChannels: 1 }
    },
    reportOnce(key) { errors.push(key) },
    invalidate() {},
  }
  const assets = new WeaponAssets({ resources, audio, scopeId: 'retry-bank' })
  t.after(() => {
    assets.dispose()
    resources.dispose()
  })
  const one = {
    cues: {
      first: { id: 'first', url: '/first.ogg' },
    },
  }
  assert.equal((await assets.preloadAudio(one))[0].status, 'rejected')
  assert.equal((await assets.preloadAudio(one))[0].status, 'fulfilled')
  assert.equal(downloads, 1)
  assert.equal(errors.length, 1)
  const pending = assets.preloadAudio({
    cues: {
      late: { id: 'late', url: '/late.ogg' },
    },
  })
  await new Promise(resolve => setImmediate(resolve))
  assets.dispose()
  delayed.resolve({ duration: 1, length: 10, numberOfChannels: 1 })
  assert.equal((await pending)[0].status, 'rejected')
  assert.equal(assets.audioCue('late'), null)
  assert.equal(assets.audioSnapshot().cues, 0)
})

function adapter(t) {
  const enqueued = []
  const cancelled = []
  const invalidated = []
  const profile = structuredClone(weaponAudioProfiles.classic)
  profile.cues.bolt = { id: 'bolt', gain: 0.2 }
  const bank = new Map(Object.keys(profile.cues).map(id => [
    id,
    {
      buffer: { duration: 2 },
      gain: 0.2,
    },
  ]))
  const audio = {
    enqueue(cue) { enqueued.push(cue) },
    cancelAction(command) { cancelled.push(command) },
    invalidate(command) { invalidated.push(command) },
    reportOnce() {},
  }
  const assets = {
    audioScope: 'test-level',
    async preloadAudio() {},
    audioCue(id) { return bank.get(id) },
    audioSnapshot() { return { cues: bank.size } },
    manifest() {
      return {
        actions: {
          fire: 'shoot',
          fireAds: 'shoot',
          draw: 'draw',
          reloadTactical: 'reload',
          reloadEmpty: 'reload',
          inspect: 'inspect',
        },
        clips: [
          {
            name: 'shoot',
            duration: 1,
            markers: [
              { time: 0, cue: 'classic_shoot' },
              { time: 0.2549, cue: 'bolt' },
            ],
          },
          {
            name: 'draw',
            duration: 1,
            markers: [
              { time: 0, cue: 'classic_draw' },
            ],
          },
          { name: 'reload', duration: 2.25, markers: [] },
          { name: 'inspect', duration: 3, markers: [] },
        ],
      }
    },
  }
  const bridge = new WeaponAudio({
    audio,
    assets,
    definitions: [classicDefinition],
    profiles: { classic: profile },
  })
  t.after(() => bridge.dispose())
  let sequence = 0
  const event = (type, at, payload = {}) => ({
    epoch: 1,
    sequence: ++sequence,
    fixedTick: Math.round(at / h),
    at,
    type,
    instanceId: 'pistol',
    payload: {
      weapon: { definitionId: 'classic' },
      ...payload,
    },
  })
  return {
    bridge,
    bank,
    enqueued,
    cancelled,
    invalidated,
    assets,
    event,
    receive(...events) { bridge.receive({ events }, { epoch: 1 }) },
    motion(at) { bridge.motion(audioTime(Math.round(at / h), at)) },
  }
}

test('accepted facts alone own start sounds; independent markers use real at and duplicate delivery is ignored', (t) => {
  const f = adapter(t)
  const committed = f.event('EquipCommitted', 0)
  const draw = f.event('DrawStarted', 0, { readyTick: 45, switchId: 1 })
  f.receive(committed, draw)
  f.motion(0)
  assert.equal(f.enqueued.length, 1)
  assert.equal(f.enqueued[0].rate, 1 / 0.75)
  f.receive(draw)
  assert.equal(f.enqueued.length, 1)
  f.receive(f.event('ShotFired', 0.1))
  f.motion(0.3)
  assert.equal(f.enqueued.filter(cue => cue.id.endsWith('classic_shoot')).length, 1)
  f.motion(0.4)
  const marker = f.enqueued.find(cue => cue.id.endsWith('marker:1'))
  assert.equal(marker.at, 0.1 + 0.2549)
  f.motion(0.5)
  assert.equal(f.enqueued.filter(cue => cue.id.endsWith('marker:1')).length, 1)
})

test('same-time cancellation wins over a future marker, and an unavailable cancelled action never starts later', (t) => {
  const f = adapter(t)
  f.receive(f.event('ShotFired', 0.1), f.event('SwitchStarted', 0.1 + 0.2549))
  f.motion(0.5)
  assert.equal(f.enqueued.some(cue => cue.id.includes('marker:')), false)
  f.bank.delete('classic_reload')
  f.receive(f.event('ReloadStarted', 0.6, { branch: 'empty', actionId: 3, endTick: 150 }))
  f.motion(0.7)
  assert.equal(f.bridge.snapshot().pending, 1)
  f.receive(f.event('ReloadCancelled', 0.8, { actionId: 3 }))
  f.motion(0.9)
  f.bank.set('classic_reload', {
    buffer: { duration: 2 },
    gain: 0.2,
  })
  f.motion(1)
  assert.equal(f.bridge.snapshot().pending, 0)
  assert.equal(f.enqueued.some(cue => cue.id.endsWith('classic_reload')), false)
})

test('an independent zero-time marker is retained, while the same start sound is still deduplicated', (t) => {
  const f = adapter(t)
  const manifest = f.assets.manifest
  f.assets.manifest = () => {
    const data = manifest()
    data.clips[0].markers.unshift({ time: 0, cue: 'bolt' })
    return data
  }
  f.receive(f.event('ShotFired', 0.1))
  f.motion(0.1)
  assert.equal(f.enqueued.length, 2)
  assert.equal(f.enqueued.filter(cue => cue.id.endsWith('classic_shoot')).length, 1)
  assert.equal(f.enqueued.filter(cue => cue.id.endsWith('marker:0')).length, 1)
})

test('epoch invalidation is immediate even without motion, and reload branches select one explicit alias', (t) => {
  const f = adapter(t)
  f.receive(f.event('ReloadStarted', 0.1, { branch: 'tactical', actionId: 1, endTick: 120 }))
  f.motion(0.2)
  assert.equal(f.enqueued.length, 1)
  const reset = {
    ...f.event('PresentationReset', 0.3),
    epoch: 2,
  }
  f.bridge.receive({
    events: [reset],
  }, { epoch: 2 })
  assert.equal(f.invalidated.length, 1)
  assert.equal(f.bridge.snapshot().epoch, 2)
  f.motion(2)
  assert.equal(f.enqueued.length, 1)
})
