import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate } from 'node:timers/promises'
import { KillFeedback } from '../src/game/range-room/challenges/kill-feedback.js'

function present(feedback, at) {
  feedback.tick({
    time: { presentationTime: at },
  })
}

function shot(at, definitionId, ...regions) {
  return {
    at,
    deaths: regions.map(region => ({ definitionId, region })),
  }
}

test('kill feedback presents each confirmed death and keeps the combo after the panel fades', () => {
  const feedback = new KillFeedback()
  feedback.receive(shot(1, 'judge', 'chest', 'chest'))
  present(feedback, 0.99)
  assert.equal(feedback.read().panel, null)
  assert.deepEqual(feedback.read().feed, [])

  present(feedback, 1)
  assert.equal(feedback.read().panel.count, 2)
  assert.equal(feedback.read().feed.length, 2)
  present(feedback, 4)
  assert.equal(feedback.read().panel, null)
  assert.equal(feedback.read().feed.length, 2)

  feedback.receive(shot(4.25, 'vandal', 'head'))
  present(feedback, 4.25)
  const { panel, feed } = feedback.read()
  assert.equal(panel.count, 3)
  assert.equal(panel.points, 62)
  assert.deepEqual(panel.bonuses, [
    { kind: 'combo', points: 32 },
    { kind: 'headshot', points: 20 },
    { kind: 'ruthless', points: 10 },
  ])
  assert.deepEqual(panel.markers, [false, false, true])
  assert.deepEqual(feed.map(entry => [entry.definitionId, entry.headshot]), [
    ['vandal', true],
    ['judge', false],
    ['judge', false],
  ])

  present(feedback, 6.5)
  assert.equal(feedback.read().feed.length, 1)
  feedback.receive(shot(9.26, 'classic', 'chest'))
  present(feedback, 9.26)
  assert.equal(feedback.read().panel.count, 1)
  present(feedback, 15)
  assert.deepEqual(feedback.read(), { at: 15, panel: null, feed: [] })
})

test('kill audio prefers one Delta Force cue per shot, limits repeats, and clears pending cues', async () => {
  const cues = []
  const loaded = new Map()
  const resources = {
    async load([entry]) { loaded.set(entry.name, entry.url) },
    get: name => loaded.get(name),
    unload: name => loaded.delete(name),
  }
  const audio = {
    async decode(url) { return { url } },
    enqueue(cue) {
      cues.push(cue)
      return true
    },
    invalidate({ scope }) {
      assert.ok(cues.every(cue => cue.scope === scope))
      cues.length = 0
    },
  }
  const feedback = new KillFeedback({ audio, resources })
  await setImmediate()

  feedback.receive(shot(1, 'judge', 'chest', 'head', 'head', 'chest'))
  present(feedback, 0.99)
  assert.equal(cues.length, 0)
  present(feedback, 1)
  assert.equal(feedback.read().feed.length, 3)
  assert.equal(feedback.read().panel.count, 4)
  assert.deepEqual(cues.map(({ group, at, gain, buffer }) => [group, at, gain, buffer.url]), [
    [
      'kill-feedback:headshot',
      1,
      0.18,
      '/audio/kill-feedback/audio_KillSounds_DeltaForce_k_deltaforce_headshot.wav',
    ],
  ])

  feedback.receive(shot(1.08, 'classic', 'head'))
  feedback.receive(shot(1.16, 'classic', 'chest'))
  feedback.receive(shot(1.24, 'classic', 'chest'))
  feedback.receive(shot(1.4, 'classic', 'chest'))
  present(feedback, 1.4)
  assert.equal(feedback.read().panel.count, 8)
  assert.deepEqual(cues.map(cue => cue.at), [1, 1.16, 1.4])
  assert.ok(cues.slice(1).every(({ buffer, gain }) =>
    buffer.url.endsWith('/audio_KillSounds_DeltaForce_k_deltaforce_normal.wav') && gain === 0.16))

  feedback.receive(shot(1.45, 'classic', 'head'))
  feedback.clear()
  present(feedback, 1.45)
  assert.equal(cues.length, 0)
  assert.deepEqual(feedback.read(), { at: 1.45, panel: null, feed: [] })

  feedback.receive(shot(1.46, 'classic', 'chest'))
  present(feedback, 1.46)
  assert.equal(cues.length, 1)
  feedback.dispose()
  assert.equal(loaded.size, 0)
})
