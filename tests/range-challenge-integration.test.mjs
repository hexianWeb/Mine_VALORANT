import assert from 'node:assert/strict'
import test from 'node:test'
import { RangeChallengeComponent } from '../src/game/range-room/challenges/range-challenge.js'
import { RangeDisplay } from '../src/game/range-room/challenges/range-display.js'
import { sectorCells, validateSectorCells } from '../src/game/range-room/challenges/spawn-grid.js'
import { ShotTargets } from '../src/game/targets/shot-targets.js'
import { TargetCombat } from '../src/game/targets/target-combat.js'

const h = 1 / 60
const time = tick => ({ fixedTick: tick, fixedElapsed: tick * h, fixedDelta: h })
function selection(patch) {
  return {
    mode: 'elimination',
    difficulty: 'easy',
    targetKills: 50,
    armor: 0,
    ...patch,
  }
}

test('elimination display publishes whole presentation seconds and freezes at the final result', () => {
  const config = selection()
  let session = { config, startedAt: 0.9, status: 'running' }
  const models = []
  const display = new RangeDisplay({
    challenge: {
      selection: config,
      readPresentedSession: () => session,
      readControlState: () => ({}),
    },
    panels: {
      update: model => models.push(model),
    },
    player: {
      enabled: true,
      lookSettings: {
        read: () => ({ sensitivity: 0.4 }),
      },
      weapons: {
        readHud() {},
      },
    },
    practiceVisible: () => false,
  })
  display.update(0.89)
  display.update(1.899)
  assert.equal(models.length, 1, 'subsecond frames do not publish a new model')
  assert.equal(display.read().columns[1].value, '0')
  display.update(1.9)
  assert.equal(display.read().timeLabel, '1')
  display.update(2.9)
  assert.equal(display.read().timeLabel, '2')
  session = {
    ...session,
    status: 'completed',
    result: { elapsed: 2.95 },
  }
  display.update(15)
  assert.equal(display.read().timeLabel, '2')
  assert.equal(session.result.elapsed, 2.95)
})

function fixture(t, { cells = null, count = 40, random = () => 0.31, mode = 'elimination', inView = null, ...trialOptions } = {}) {
  const targets = new ShotTargets()
  const sourceId = targets.openSource(1)
  const handles = []
  const lent = new Set()
  let activations = 0
  let sequence = 0
  let tick = 1
  let beforeShotActivations = 0
  for (let index = 0; index < count; index++) {
    const id = `bot:${index}`
    const model = new TargetCombat()
    const bot = {
      activateSpawn(spawn, config) {
        activations++
        model.activate(spawn, config)
      },
      removeSpawn() { model.deactivate() },
      captureIdentity() { return model.identity ?? {} },
      trace(origin) {
        return model.eligible && origin[0] === index
          ? {
              distance: 2,
              normal: [0, 0, 1],
              region: 'head',
            }
          : null
      },
      prepareDamage(entries, shot, context) { return model.prepareDamage(entries, shot, context) },
      commitDamage(plan) {
        assert.equal(activations, beforeShotActivations, 'no target activates before the complete result returned')
        model.commitDamage(plan)
        return {
          damage: plan.damage,
          deaths: plan.lethal
            ? [
                { ...plan.lethal, type: 'TargetKilled' },
              ]
            : [],
          reactions: [],
        }
      },
      model,
    }
    targets.register(id, bot)
    handles.push({ id, bot, index })
  }
  const pool = {
    available: () => handles.length - lent.size,
    acquire(amount) {
      const result = handles.filter(handle => !lent.has(handle)).slice(0, amount)
      for (const handle of result) lent.add(handle)
      return result
    },
    release(handle) {
      assert.ok(lent.delete(handle), 'return each borrowed handle exactly once')
    },
  }
  const practice = []
  const challenge = new RangeChallengeComponent({
    cells: cells ?? validateSectorCells(sectorCells({
      position: [0, 1, 0],
      yaw: 0,
    }), () => 2),
    pool,
    random,
    fixedDelta: h,
    bodyHideDelay: 0.05,
    inView,
    ...trialOptions,
    setPracticeEnabled: value => practice.push(value),
  })
  t.after(() => challenge.dispose())
  challenge.prepare(selection({ mode }))
  const start = () => {
    const state = challenge.readControlState()
    challenge.onShotResolved({
      sourceId,
      epoch: 1,
      sequence: ++sequence,
      fixedTick: tick,
      at: tick * h,
      disposition: 'interaction',
      interactions: [
        { type: 'StartRequested', revision: state.revision, selection: state.selection },
      ],
      deaths: [],
    }, time(tick))
  }
  const fixed = (next = tick + 1) => {
    tick = next
    challenge.tick({
      phase: 'fixed',
      time: time(tick),
    })
  }
  const shoot = (amount, definitionId = 'phantom', region = 'head') => {
    const state = challenge.snapshot()
    const active = state.simulation.active.slice(0, amount)
    targets.beginShot(time(tick))
    beforeShotActivations = activations
    const pellets = active.map((spawn, index) => {
      const handle = handles.find(handle => handle.id === spawn.targetId)
      return {
        index,
        direction: [0, 0, -1],
        impact: {
          ...targets.trace([handle.index, 1, 0], [0, 0, -1], 200),
          region,
        },
      }
    })
    const result = targets.resolveShot({
      sourceId,
      epoch: 1,
      sequence: ++sequence,
      type: 'ShotFired',
      instanceId: 'gun',
      fixedTick: tick,
      at: tick * h,
      payload: {
        weapon: { definitionId },
        pellets: pellets.length
          ? pellets
          : [
              {
                index: 0,
                direction: [0, 0, -1],
                impact: {
                  distance: 200,
                  position: [0, 0, -200],
                  normal: null,
                },
              },
            ],
      },
    }, time(tick))
    assert.equal(activations, beforeShotActivations)
    challenge.onShotResolved(result, time(tick))
    return result
  }
  return {
    challenge,
    targets,
    handles,
    start,
    fixed,
    shoot,
    practice,
    lent,
    get tick() { return tick },
  }
}

test('haoqi: manual charge, new trigger per visible batch, paused flow, timed completion and CSV attribution', (t) => {
  let now = 0
  let weapon = 'classic'
  t.mock.method(performance, 'now', () => now * 1000)
  const f = fixture(t, {
    mode: 'haoqi',
    activeWeapon: () => weapon,
    projectHead: spawn => ({
      id: spawn.spawnId,
      x: 0.5,
      y: 0.5,
      distance: 0,
      point: [0, 1, -5],
    }),
  })
  assert.equal(f.challenge.readControlState().ready, false)
  weapon = 'vandal'
  f.start()
  const trial = f.challenge.trial
  assert.equal(trial.charge, 108)
  const tick = () => {
    f.fixed()
    f.challenge.tick({
      phase: 'motion',
      time: { presentationTime: f.tick * h },
    })
  }
  f.shoot(0, 'vandal')
  for (let i = 0; i < 6; i++) {
    now += 0.5
    tick()
    f.shoot(1, 'vandal')
  }
  assert.equal(trial.inFlow, true)
  assert.equal(trial.outsideKills, 6)
  assert.equal(trial.firstFlow, 3)
  now = 3.2
  tick()
  tick()
  assert.ok(trial.locks.length)
  assert.equal(trial.allowFire(false, 'vandal'), false, 'held trigger from charge phase is not a confirmation')
  assert.equal(trial.allowFire(true, 'vandal'), true)
  assert.ok(trial.guide([0, 0, 0]))
  f.shoot(1, 'vandal')
  const remaining = trial.remaining
  assert.equal(trial.flowKills, 1)
  f.challenge.pausePlaytest(true, f.tick * h)
  now += 60
  assert.equal(trial.remaining, remaining)
  f.challenge.pausePlaytest(false, f.tick * h)
  now = 68.6
  tick()
  assert.equal(trial.inFlow, false)
  assert.equal(trial.charge, 0)
  f.shoot(0, 'vandal')
  now = 90
  tick()
  assert.equal(f.challenge.trial, null)
  assert.equal(f.challenge.running, false)
  const log = f.challenge.playtests
  const file = log.exportCsv(log.choices[0].id)
  const [head, ...rows] = file.csv.trim().split('\r\n').map(line => line.split(','))
  const events = rows.filter(r => r[head.indexOf('event')] === 'kill')
  assert.deepEqual(events.map(r => r[head.indexOf('shot_phase')]), [
    ...Array.from({ length: 6 }).fill('outside'),
    'flow',
  ])
  const end = Object.fromEntries(head.map((k, i) => [k, rows.at(-1)[i]]))
  assert.deepEqual([
    end.reason,
    end.active_ms,
    end.outside_kills,
    end.flow_kills,
    end.first_flow_ms,
    end.first_confirm_ms,
    end.first_post_flow_shot_ms,
  ], [
    'completed',
    '30000',
    '6',
    '1',
    '3000',
    '3200',
    '8600',
  ])
})

test('playtest export reconciles whole shots, partial damage, confirmed deaths, exposure and pauses across restarts', (t) => {
  let now = 10
  t.mock.method(performance, 'now', () => now)
  const f = fixture(t, {
    inView: spawn => spawn.spawnId.endsWith(':1'),
  })
  const log = f.challenge.playtests
  f.start()
  const motion = () => f.challenge.tick({
    phase: 'motion',
    time: { presentationTime: f.tick * h },
  })
  motion()
  motion()
  f.fixed()
  f.shoot(0) // wall/air: one accepted shot, no damage
  f.shoot(1, 'classic', 'chest') // non-lethal hit
  const batch = f.shoot(2)
  f.challenge.onShotResolved(batch, time(f.tick)) // duplicate delivery after refilling must not count
  now += 700
  log.pause(true, f.tick * h)
  now += 5000
  log.pause(false, f.tick * h)
  now += 300
  f.challenge.cancel()
  const first = log.choices[0].id
  f.start()
  f.challenge.cancel()
  assert.equal(log.choices.length, 2)
  assert.notEqual(first, log.choices[0].id)
  const { csv, filename } = log.exportCsv(first, 'P01')
  assert.match(filename, /^range-P01-.*\.csv$/u)
  assert.equal(csv.charCodeAt(0), 0xFEFF)
  const [keys, ...values] = csv.trim().split('\r\n').map(line => line.split(','))
  const rows = values.map(fields => Object.fromEntries(keys.map((key, i) => [key, fields[i]])))
  const select = type => rows.filter(row => row.event === type)
  assert.deepEqual(select('shot').map(r => [r.weapon, r.hit]), [
    ['phantom', '0'],
    ['classic', '1'],
    ['phantom', '1'],
  ])
  assert.deepEqual(select('damage').map(r => r.region), ['chest', 'head', 'head'])
  const multiKillShot = select('shot')[2].shot_id
  assert.deepEqual(select('kill').map(r => r.shot_id), [multiKillShot, multiKillShot])
  assert.equal(select('spawn').length, 12)
  assert.deepEqual(select('first_in_view').map(r => r.spawn_id), [select('spawn')[0].spawn_id])
  assert.equal(rows[0].event, 'run_start')
  const end = rows.at(-1)
  assert.equal(end.event, 'run_end')
  assert.equal(end.reason, 'cancelled')
  assert.deepEqual([
    end.shots,
    end.misses,
    end.kills,
    end.head_kills,
    end.score_kills,
  ], ['3', '1', '2', '2', '2'])
  assert.deepEqual([end.wall_ms, end.active_ms], ['6000', '1000'])
  assert.deepEqual([
    Number(end.kpm),
    Number(end.head_kill_rate),
    end.miss_rate,
  ], [120, 1, '0.333333'])
  assert.ok(rows.every(r => r.player_id === 'P01' && r.run_id === first && r.mode === 'elimination'))
})

test('logic adapter starts ten synchronously, consumes a whole shot then refills only its deaths; P does not mutate rules', (t) => {
  const f = fixture(t)
  f.start()
  let state = f.challenge.snapshot()
  assert.equal(state.simulation.active.length, 10)
  assert.equal(new Set(state.simulation.active.map(spawn => spawn.at)).size, 1)
  assert.equal(state.simulation.startedAt, h)
  assert.deepEqual(f.practice, [false])
  assert.equal(f.challenge.readControlState().enabled, false)
  assert.match(f.challenge.armoryRestriction(), /本局/)
  const before = state.simulation.active
  f.fixed()
  const result = f.shoot(3)
  assert.equal(result.deaths.length, 3)
  state = f.challenge.snapshot()
  assert.equal(state.simulation.kills, 3)
  assert.equal(state.simulation.active.length, 10)
  for (const spawn of before.slice(3))
    assert.deepEqual(state.simulation.active.find(next => next.spawnId === spawn.spawnId), spawn)
  assert.equal(state.grid.owners.filter(owner => owner.releaseAt !== null).length, 3)
  assert.equal(state.grid.owners.length, 13)
  f.challenge.onShotResolved(result, time(f.tick))
  assert.equal(f.challenge.snapshot().simulation.kills, 3)
  const simulation = f.challenge.snapshot().simulation
  f.challenge.tick({
    phase: 'motion',
    time: { presentationTime: h },
  })
  assert.equal(f.challenge.snapshot().presentation.state.kills, 0)
  f.challenge.tick({
    phase: 'motion',
    time: { presentationTime: f.tick * h },
  })
  assert.equal(f.challenge.snapshot().presentation.state.kills, 3)
  assert.deepEqual(f.challenge.snapshot().simulation, simulation)
  f.fixed(f.tick + 3)
  assert.equal(f.challenge.snapshot().grid.owners.length, 10)
})

test('adapter mode one expiry runs before same-step fire and replacement uses a new identity and another cell', (t) => {
  const f = fixture(t, { mode: 'shooting-test' })
  f.start()
  const old = f.challenge.snapshot().simulation.active[0]
  f.fixed(old.deadlineTick)
  const next = f.challenge.snapshot().simulation.active[0]
  assert.notEqual(next.spawnId, old.spawnId)
  assert.notEqual(next.cellId, old.cellId)
  assert.equal(f.challenge.snapshot().simulation.settled, 1)
  f.shoot(1)
  const state = f.challenge.snapshot()
  assert.equal(state.simulation.kills, 1)
  assert.equal(state.simulation.settled, 2)
  assert.equal(state.simulation.active.length, 1)
})

test('actual damage/death batches reach fifty then stop refill, preserve real retirements and freeze result', (t) => {
  const f = fixture(t)
  f.start()
  for (let batch = 0; batch < 5; batch++) {
    f.fixed(f.tick + 4)
    const result = f.shoot(10)
    assert.equal(result.deaths.length, 10)
  }
  const state = f.challenge.snapshot()
  assert.equal(state.simulation.kills, 50)
  assert.equal(state.simulation.result.completedAt, f.tick * h)
  assert.equal(f.challenge.playtests.choices[0].reason, 'completed')
  assert.equal(f.challenge.playtests.choices[0].kills, 50)
  assert.equal(state.simulation.active.length, 0)
  assert.equal(state.grid.owners.length, 10, 'natural completion retains visible-death protection')
  assert.equal(f.challenge.armoryRestriction(), null)
  f.fixed(f.tick + 3)
  assert.equal(f.challenge.snapshot().grid.owners.length, 0)
  assert.deepEqual(f.challenge.snapshot().simulation.result, state.simulation.result)
  assert.equal(f.lent.size, 0)
})

test('readiness blocks insufficient buffered capacity/pool; runtime refill failure aborts with no valid score or waiting', (t) => {
  const tiny = [
    {
      cellId: 'only',
      i: 0,
      j: 0,
      position: [0, 0, 0],
    },
  ]
  const bad = fixture(t, { cells: tiny })
  assert.equal(bad.challenge.readControlState().ready, false)
  bad.start()
  assert.equal(bad.challenge.running, false)
  assert.equal(bad.challenge.snapshot().simulation.result, null)
  const poolLimited = fixture(t, { count: 9 })
  assert.equal(poolLimited.challenge.readControlState().ready, false)
  const noBuffer = fixture(t, { count: 10 })
  assert.equal(noBuffer.challenge.readControlState().ready, false)
  const f = fixture(t, { count: 20 })
  f.start()
  f.fixed()
  f.shoot(10)
  f.fixed()
  f.shoot(1)
  const state = f.challenge.snapshot()
  assert.equal(state.simulation.status, 'idle')
  assert.equal(state.simulation.result, null)
  assert.equal(state.grid.owners.length, 0)
  assert.equal(f.lent.size, 0)
  assert.match(state.reason, /Pool/)
})

test('explicit cancel preserves pause/no-step state first, clears all ownership and invalidates old deaths on restart', (t) => {
  const f = fixture(t)
  f.start()
  f.fixed()
  const old = f.shoot(1)
  const paused = f.challenge.snapshot().simulation
  for (let frame = 0; frame < 10; frame++)
    assert.deepEqual(f.challenge.snapshot().simulation, paused)
  f.challenge.requestCancel()
  assert.equal(f.challenge.running, true)
  f.fixed()
  assert.equal(f.challenge.running, false)
  assert.equal(f.challenge.snapshot().grid.owners.length, 0)
  assert.equal(f.lent.size, 0)
  f.start()
  assert.notEqual(f.challenge.snapshot().simulation.sessionId, old.deaths[0].sessionId)
  const delayed = {
    ...old,
    sequence: old.sequence + 100,
    fixedTick: f.tick,
    at: f.tick * h,
  }
  f.challenge.onShotResolved(delayed, time(f.tick))
  assert.equal(f.challenge.snapshot().simulation.kills, 0)
  assert.equal(f.challenge.snapshot().simulation.active.length, 10)
  f.challenge.cancel('editor')
  assert.equal(f.challenge.snapshot().grid.owners.length, 0)
})
