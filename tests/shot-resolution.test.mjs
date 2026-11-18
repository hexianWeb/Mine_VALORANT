import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { fixedDamage, fixedWeaponDamage, hitRegionDamage, validateDamageProfile } from '../src/game/combat/fixed-damage.js'
import { RangePanelControl } from '../src/game/range-room/challenges/panel-control.js'
import { ShotTargets } from '../src/game/targets/shot-targets.js'
import { TargetCombat } from '../src/game/targets/target-combat.js'

const h = 1 / 60
const time = tick => ({ fixedTick: tick, fixedElapsed: tick * h, fixedDelta: h })
const selection = {
  mode: 'shooting-test',
  difficulty: 'easy',
  targetKills: 50,
  armor: 0,
}

function fixture(count = 2, armor = 0) {
  const targets = new ShotTargets()
  const sourceId = targets.openSource(1)
  let sequence = 0
  const bots = Array.from({ length: count }, (_, index) => {
    const model = new TargetCombat()
    const id = `bot:${index}`
    model.activate({
      sessionId: 'session:1',
      spawnId: `spawn:${index}`,
      cellId: `cell:${index}`,
      targetId: id,
    }, { maxArmor: armor })
    const feedback = []
    const bot = {
      model,
      feedback,
      trace(origin) {
        return model.eligible && origin[0] === index
          ? {
              distance: 2,
              region: 'chest',
              normal: [0, 0, 1],
              surface: 'metal',
            }
          : null
      },
      captureIdentity() { return model.identity },
      prepareDamage(entries, shot, context) { return model.prepareDamage(entries, shot, context) },
      commitDamage(plan, shot, timing) {
        if (!model.commitDamage(plan))
          return { damage: [], deaths: [], reactions: [] }
        if (plan.lethal) {
          const death = {
            ...plan.lethal,
            type: 'TargetKilled',
            ...shot,
            ...timing,
            at: timing.fixedElapsed,
          }
          feedback.push(death)
          return {
            damage: plan.damage,
            deaths: [death],
            reactions: [],
          }
        }
        const reaction = { type: 'TargetReacted', ...model.identity, at: timing.fixedElapsed }
        feedback.push(reaction)
        return {
          damage: plan.damage,
          deaths: [],
          reactions: [reaction],
        }
      },
    }
    bot.unregister = targets.register(id, bot)
    return bot
  })
  const impact = (index, region = 'chest') => ({
    ...targets.trace([index, 1, 0], [0, 0, -1], 200),
    region,
  })
  const event = (hits, definitionId = 'judge', tick = 1) => ({
    sourceId,
    epoch: 1,
    sequence: ++sequence,
    type: 'ShotFired',
    instanceId: 'gun',
    fixedTick: tick,
    at: tick * h,
    payload: {
      weapon: { definitionId },
      pellets: hits.map((hit, index) => ({
        index,
        direction: [0, 0, -1],
        impact: hit,
      })),
    },
  })
  const resolve = (hits, definitionId, tick = 1) => targets.resolveShot(event(hits, definitionId, tick), time(tick))
  return {
    targets,
    bots,
    sourceId,
    impact,
    event,
    resolve,
  }
}

test('fixed damage covers firearms and flat karambit damage across all six profile regions', () => {
  const profile = JSON.parse(fs.readFileSync(new URL('../public/targets/training-bot/range-training-bot.hitboxes.json', import.meta.url)))
  validateDamageProfile(profile)
  assert.deepEqual(Object.keys(hitRegionDamage).sort(), Object.keys(profile.regions).sort())
  assert.equal(fixedDamage('sheriff', 'head'), 159.5)
  assert.equal(fixedDamage('phantom', 'leg_r'), 33.15)
  assert.equal(fixedDamage('judge', 'leg_l'), 14.45)
  assert.equal(fixedDamage('classic', 'arm_l'), 26)
  assert.equal(fixedDamage('odin', 'head'), 95)
  assert.equal(fixedDamage('bulldog', 'head'), 115.5)
  assert.equal(fixedDamage('bulldog', 'chest'), 35)
  assert.equal(fixedDamage('bulldog', 'leg_r'), 29.75)
  assert.equal(fixedDamage('outlaw', 'head'), 40.8)
  assert.equal(fixedDamage('outlaw', 'chest'), 24)
  assert.equal(fixedDamage('outlaw', 'leg_r'), 20.4)
  assert.equal(fixedDamage('operator', 'head'), 75)
  assert.equal(fixedDamage('operator', 'chest'), 50)
  assert.equal(fixedDamage('operator', 'leg_r'), 42.5)
  assert.equal(Object.keys(fixedWeaponDamage).length, 11)
  for (const region of Object.keys(profile.regions)) assert.equal(fixedDamage('karambit', region), 50)
  assert.throws(() => fixedDamage('missing', 'head'), /Missing/)
  assert.throws(() => fixedDamage('judge', 'unknown'), /Missing/)
  assert.throws(() => validateDamageProfile({
    ...profile,
    regions: { ...profile.regions, tail: 'clip' },
  }), /tail/)
})

test('a melee contact applies one damage instance, skips panel interactions, and rejects replays', () => {
  const f = fixture(1)
  let panelQueries = 0
  f.bots[0].prepareInteraction = () => {
    panelQueries++
    return { type: 'StartRequested' }
  }
  const contact = tick => ({
    ...f.event([], 'karambit', tick),
    type: 'MeleeContact',
    payload: {
      weapon: { definitionId: 'karambit' },
      direction: [0, 0, -1],
      impact: f.impact(0),
    },
  })
  const first = contact(20)
  const hit = f.targets.resolveShot(first, time(20))
  assert.deepEqual(hit.damage.map(({ amount, health }) => [amount, health]), [
    [50, 50],
  ])
  assert.equal(hit.reactions.length, 1)
  assert.equal(f.targets.resolveShot(first, time(20)).disposition, 'ignored')
  const lethal = f.targets.resolveShot(contact(80), time(80))
  assert.equal(lethal.deaths.length, 1)
  assert.equal(f.bots[0].model.snapshot().attributes.health, 0)
  assert.equal(panelQueries, 0)
})

test('pellets cumulatively damage independent targets, never count the summary hit twice, and emit one death/feedback', () => {
  const f = fixture()
  const hits = [
    ...Array.from({ length: 8 }, () => f.impact(0)),
    f.impact(1, 'leg_l'),
    f.impact(1, 'head'),
  ]
  const event = f.event(hits)
  event.payload.impact = f.impact(1, 'head')
  const result = f.targets.resolveShot(event, time(1))
  assert.equal(result.disposition, 'combat')
  assert.equal(result.damage.filter(hit => hit.targetId === 'bot:0').length, 6)
  assert.equal(result.deaths.length, 1)
  assert.equal(result.deaths[0].pelletIndex, 5)
  assert.equal(f.bots[0].model.snapshot().attributes.health, 0)
  assert.equal(f.bots[0].feedback.length, 1)
  assert.equal(f.bots[0].feedback[0].type, 'TargetKilled')
  assert.equal(f.bots[1].model.snapshot().attributes.health, 100 - 14.45 - 34)
  assert.equal(f.bots[1].feedback.length, 1)
  assert.equal(result.reactions.length, 1)
  assert.ok(Object.isFrozen(result.damage[0].impact.position))
  assert.equal(f.targets.trace([0, 1, 0], [0, 0, -1], 200), null, 'death immediately removes hit eligibility')
})

test('50 armor uses the existing two-thirds contract and fractional legs are not rounded; distance is not damage input', () => {
  const f = fixture(2, 50)
  const near = f.impact(0, 'leg_l')
  const far = {
    ...f.impact(1, 'leg_l'),
    distance: 150,
  }
  const result = f.resolve([near, far], 'judge')
  assert.equal(result.damage[0].amount, 14.45)
  assert.equal(result.damage[0].armorDamage, 14.45 * (2 / 3))
  assert.equal(result.damage[0].healthDamage, 14.45 - 14.45 * (2 / 3))
  assert.equal(f.bots[0].model.snapshot().attributes.health, f.bots[1].model.snapshot().attributes.health)
  assert.equal(f.bots[0].model.snapshot().attributes.armor, f.bots[1].model.snapshot().attributes.armor)
})

test('prevalidation is whole-shot atomic for late unknown regions, weapons, duplicate indices and nonfinite target plans', () => {
  for (const fault of [
    'region',
    'weapon',
    'duplicate',
    'nonfinite',
  ]) {
    const f = fixture()
    const event = f.event([
      f.impact(0),
      f.impact(1),
    ], fault === 'weapon'
      ? 'unknown'
      : 'classic')
    if (fault === 'region')
      event.payload.pellets[1].impact.region = 'unknown'
    if (fault === 'duplicate')
      event.payload.pellets[1].index = 0
    if (fault === 'nonfinite') {
      f.bots[1].prepareDamage = () => ({
        damage: [
          { amount: Number.NaN },
        ],
      })
    }
    assert.throws(() => f.targets.resolveShot(event, time(1)))
    assert.equal(f.bots[0].model.snapshot().attributes.health, 100)
    assert.equal(f.bots[1].model.snapshot().attributes.health, 100)
    assert.equal(f.bots[0].feedback.length, 0)
  }
  const f = fixture(1)
  const event = f.event([
    f.impact(0),
  ], 'classic')
  event.payload.pellets[0].direction = [0, 0, -2]
  assert.throws(() => f.targets.resolveShot(event, time(1)))
  assert.equal(f.bots[0].model.snapshot().attributes.health, 100)
})

test('identity/source cursors suppress duplicates, old epochs, unregistered lives and reused object ids without unbounded shot logs', () => {
  const f = fixture(1)
  const hit = f.impact(0)
  const event = f.event([hit], 'classic')
  const first = f.targets.resolveShot(event, time(1))
  assert.equal(first.damage.length, 1)
  assert.equal(f.targets.resolveShot(event, time(1)).disposition, 'ignored')
  f.targets.setSourceEpoch(f.sourceId, 2)
  assert.equal(f.resolve([hit], 'classic').disposition, 'ignored')
  const next = f.event([hit], 'classic')
  next.epoch = 2
  f.bots[0].model.activate({
    sessionId: 'session:2',
    spawnId: 'spawn:new',
    cellId: 'new',
    targetId: 'bot:0',
  })
  assert.equal(f.targets.resolveShot(next, time(1)).disposition, 'none')
  assert.equal(f.bots[0].model.snapshot().attributes.health, 100)
  const fresh = f.impact(0)
  f.bots[0].unregister()
  f.targets.register('bot:0', f.bots[0])
  const reused = f.event([fresh], 'classic')
  reused.epoch = 2
  assert.equal(f.targets.resolveShot(reused, time(1)).disposition, 'none')
  f.targets.closeSource(f.sourceId)
  const closed = f.event([
    f.impact(0),
  ], 'classic')
  closed.epoch = 2
  assert.equal(f.targets.resolveShot(closed, time(1)).disposition, 'ignored')
  assert.equal(f.bots[0].model.snapshot().attributes.health, 100)
})

test('target preview plans cannot be committed twice or applied to a replacement life', () => {
  const f = fixture(1)
  const entries = [
    {
      index: 0,
      impact: f.impact(0),
    },
  ]
  const shot = { definitionId: 'classic' }
  const plan = f.bots[0].model.prepareDamage(entries, shot, time(1))
  f.bots[0].model.commitDamage(plan)
  assert.equal(f.bots[0].model.commitDamage(plan), null)
  assert.equal(f.bots[0].model.snapshot().attributes.health, 74)
  f.bots[0].model.activate({ sessionId: 'new', spawnId: 'new', cellId: 'new' }, { maxArmor: 50 })
  assert.equal(f.bots[0].model.commitDamage(plan), null)
  assert.equal(f.bots[0].model.snapshot().attributes.health, 100)
})

test('legal panel start consumes all pellets, binds captured options and waits for the result consumer to spawn', () => {
  const f = fixture(1)
  let state = {
    enabled: true,
    ready: true,
    revision: 1,
    selection,
  }
  const control = new RangePanelControl({
    id: 'start',
    action: 'start',
    readState: () => state,
    trace: origin => origin[0] === 99
      ? {
          distance: 1,
          region: null,
          normal: [0, 0, 1],
          surface: 'metal',
        }
      : null,
  })
  f.targets.register('panel', control)
  f.targets.beginShot(time(1))
  const panel = f.targets.trace([99, 1, 0], [0, 0, -1], 200)
  state = {
    ...state,
    selection: { ...selection, difficulty: 'hard' },
  }
  const result = f.resolve([
    f.impact(0, 'head'),
    panel,
    panel,
  ], 'sheriff')
  assert.equal(result.disposition, 'interaction')
  assert.equal(result.interactions.length, 1)
  assert.equal(result.interactions[0].selection.difficulty, 'easy', 'never read later DOM/options into an old hit')
  assert.equal(result.damage.length, 0)
  assert.equal(result.deaths.length, 0)
  assert.equal(f.bots[0].model.snapshot().attributes.health, 100)
  assert.equal(f.bots[0].feedback.length, 0)
  assert.equal(f.bots.length, 1, 'registry never spawns or notifies challenge from a pellet callback')
  state = { ...state, enabled: false }
  f.targets.beginShot(time(2))
  const disabled = f.targets.trace([99, 1, 0], [0, 0, -1], 200)
  assert.equal(disabled.hit, 'panel', 'disabled controls still occlude')
  const rejected = f.resolve([
    disabled,
    f.impact(0, 'head'),
  ], 'sheriff', 2)
  assert.equal(rejected.disposition, 'combat')
  assert.equal(rejected.deaths.length, 1)
})

test('panel revision changes and non-fixed shot contexts cannot start or partially damage', () => {
  const f = fixture(1)
  let revision = 1
  const panel = new RangePanelControl({
    id: 'start',
    action: 'start',
    readState: () => ({
      enabled: true,
      ready: true,
      revision,
      selection,
    }),
    trace: () => ({
      distance: 0.5,
      normal: [0, 0, 1],
    }),
  })
  f.targets.register('panel', panel)
  f.targets.beginShot(time(1))
  const hit = f.targets.trace([99, 1, 0], [0, 0, -1], 200)
  revision++
  assert.equal(f.resolve([hit], 'classic').disposition, 'none')
  const event = f.event([hit], 'classic')
  assert.throws(() => f.targets.resolveShot(event, {
    ...time(1),
    timeScale: 0,
  }), /fixed step/)
  event.fixedTick = 2
  assert.throws(() => f.targets.resolveShot(event, time(1)), /fixed step/)
})

test('practice and four sensitivity commands use the same one-command/whole-shot consumption boundary', () => {
  for (const delta of [null, -0.1, -0.01, 0.01, 0.1]) {
    const f = fixture(1)
    f.targets.register('control', new RangePanelControl({
      id: 'control',
      action: delta === null
        ? 'practice'
        : 'sensitivity',
      delta,
      readState: () => ({
        enabled: true,
        ready: true,
        revision: 1,
        selection,
      }),
      trace: origin => origin[0] === 99
        ? {
            distance: 1,
            normal: [0, 0, 1],
          }
        : null,
    }))
    f.targets.beginShot(time(1))
    const hit = f.targets.trace([99, 1, 0], [0, 0, -1], 200)
    const result = f.resolve([
      f.impact(0, 'head'),
      hit,
      hit,
    ], 'sheriff')
    assert.equal(result.disposition, 'interaction')
    assert.equal(result.interactions.length, 1)
    assert.equal(result.interactions[0].type, delta === null
      ? 'PracticeRequested'
      : 'SensitivityRequested')
    assert.equal(result.interactions[0].delta, delta)
    assert.equal(f.bots[0].model.snapshot().attributes.health, 100)
    assert.equal(result.damage.length, 0)
  }
})
