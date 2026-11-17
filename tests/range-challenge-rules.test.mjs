import assert from 'node:assert/strict'
import test from 'node:test'
import { ChallengeSession } from '../src/game/range-room/challenges/challenge-session.js'
import { challengeRules, lockChallengeConfig } from '../src/game/range-room/challenges/config.js'
import { GridCapacityError, sectorCells, SpawnGrid, validateSectorCells } from '../src/game/range-room/challenges/spawn-grid.js'

const h = 1 / 60
const time = tick => ({ fixedTick: tick, fixedElapsed: tick * h, fixedDelta: h })
function selection(patch = {}) {
  return {
    mode: 'shooting-test',
    difficulty: 'easy',
    targetKills: 50,
    armor: 0,
    ...patch,
  }
}
const placements = count => Array.from({ length: count }, (_, i) => ({ targetId: `target:${i}`, cellId: `${i * 2},4` }))
function fill(session, tick) {
  const state = session.snapshot()
  return session.activateBatch(placements(state.deficit).map((spawn, index) => ({
    ...spawn,
    targetId: `target:${state.kills}:${state.settled}:${index}`,
    cellId: `batch:${state.kills}:${state.settled}:${index}`,
  })), time(tick))
}
function death(spawn, tick, pelletIndex = 0) {
  return {
    ...spawn,
    at: tick * h,
    fixedTick: tick,
    pelletIndex,
  }
}

test('locked rules use only the confirmed values, ceil windows once, and reject silent overrides', () => {
  for (const [difficulty, ticks] of [
    ['easy', 120],
    ['medium', 60],
    ['hard', 30],
  ]) {
    const config = lockChallengeConfig(selection({ difficulty }), h)
    assert.equal(config.windowTicks, ticks)
    assert.equal(config.concurrency, 1)
    assert.equal(config.goal, 30)
    assert.equal(config.rules.cellSize, 1)
    assert.equal(config.rules.spawnDelay, 0)
    assert.equal(config.maxHealth, 100)
    assert.equal(config.maxArmor, 0)
    assert.ok(Object.isFrozen(config.rules.windows))
  }
  const config = lockChallengeConfig(selection({ mode: 'elimination', targetKills: 100, armor: 50 }), h)
  assert.equal(config.concurrency, 10)
  assert.equal(config.windowTicks, null)
  assert.equal(config.maxArmor, 50)
  assert.equal(lockChallengeConfig(selection({ difficulty: 'hard' }), 0.07).windowTicks, 8)
  for (const patch of [
    { mode: 'other' },
    { difficulty: 'normal' },
    { targetKills: 30 },
    { armor: 100 },
    { concurrency: 9 },
    { cellSize: 2 },
  ])
    assert.throws(() => lockChallengeConfig(selection(patch), h))
  assert.throws(() => lockChallengeConfig(selection(), 2), /collapses/)
})

test('shooting test has exactly 30 opportunities, one life, half-open deadlines and no target 31', () => {
  const session = new ChallengeSession()
  session.start(selection(), time(1), 'owner')
  fill(session, 1)
  assert.equal(session.snapshot().active.length, 1)
  const first = session.snapshot().active[0]
  assert.equal(first.deadlineTick, 121)
  assert.throws(() => session.resolveDeaths([
    death(first, 121),
  ], time(121)), /Deadline/)
  const expired = session.fixed(time(121))
  assert.equal(expired.removed[0].reason, 'expired')
  assert.equal(session.snapshot().kills, 0)
  fill(session, 121)
  assert.equal(session.resolveDeaths([
    death(first, 121),
  ], time(121)).removed.length, 0)
  assert.equal(session.snapshot().active.length, 1, 'old identity cannot kill replacement')
  let tick = 122
  for (let opportunity = 1; opportunity < 30; opportunity++, tick++) {
    const spawn = session.snapshot().active[0]
    const transition = session.resolveDeaths([
      death(spawn, tick),
      death(spawn, tick),
    ], time(tick))
    assert.equal(transition.removed.filter(item => item.reason === 'killed').length, 1)
    if (opportunity < 29)
      fill(session, tick)
  }
  const state = session.snapshot()
  assert.equal(state.status, 'completed')
  assert.equal(state.kills, 29)
  assert.equal(state.settled, 30)
  assert.equal(state.active.length, 0)
  assert.equal(state.result.kills, 29)
  assert.equal(session.deficit, 0)
  assert.throws(() => fill(session, tick))
  session.fixed(time(tick + 1000))
  assert.equal(session.snapshot().result.elapsed, state.result.elapsed)
})

test('misses, nonlethal hits and paused/no-step reads do not reset windows or spend opportunities', () => {
  const session = new ChallengeSession()
  session.start(selection({ difficulty: 'hard' }), time(1), 'owner')
  fill(session, 1)
  const before = session.snapshot()
  for (let tick = 2; tick <= 30; tick++) {
    session.fixed(time(tick))
    session.resolveDeaths([], time(tick))
  }
  assert.deepEqual(session.snapshot().active, before.active)
  for (let frame = 0; frame < 100; frame++) assert.deepEqual(session.snapshot().active, before.active)
  assert.equal(session.snapshot().settled, 0)
  session.fixed(time(31))
  assert.equal(session.snapshot().settled, 1)
  assert.throws(() => session.fixed({
    ...time(32),
    timeScale: 0,
  }))
})

test('thirty unattended deadlines finish at 0/30 without a shot consumer or an extra target', () => {
  const session = new ChallengeSession()
  session.start(selection({ difficulty: 'medium' }), time(1), 'owner')
  fill(session, 1)
  for (let index = 0; index < 30; index++) {
    const spawn = session.snapshot().active[0]
    const transition = session.fixed(time(spawn.deadlineTick))
    assert.equal(transition.removed.length, 1)
    assert.equal(session.snapshot().settled, index + 1)
    if (index < 29)
      fill(session, spawn.deadlineTick)
  }
  const state = session.snapshot()
  assert.equal(state.result.kills, 0)
  assert.equal(state.result.settled, 30)
  assert.equal(state.active.length, 0)
  assert.equal(state.deficit, 0)
})

test('elimination keeps ten independent identities, bulk-replaces only deaths and has no timeout', () => {
  const session = new ChallengeSession()
  session.start(selection({ mode: 'elimination' }), time(1), 'owner')
  fill(session, 1)
  const initial = session.snapshot().active
  session.fixed(time(100000))
  assert.deepEqual(session.snapshot().active, initial)
  const removed = session.resolveDeaths([
    death(initial[2], 100000, 6),
    death(initial[0], 100000, 1),
    death(initial[2], 100000, 7),
  ], time(100000))
  assert.equal(session.snapshot().kills, 2)
  assert.equal(removed.deficit, 2)
  assert.deepEqual(removed.removed.map(item => item.spawn.spawnId), [initial[0].spawnId, initial[2].spawnId])
  assert.deepEqual(session.snapshot().active, initial.filter((_, index) => ![0, 2].includes(index)))
  fill(session, 100000)
  assert.equal(session.snapshot().active.length, 10)
  assert.equal(session.resolveDeaths([
    death(initial[0], 100000),
  ], time(100000)).removed.length, 0)
})

test('same-shot over-goal deaths are real but score caps authoritatively and survivors clear without kills', () => {
  for (const targetKills of [50, 100]) {
    const session = new ChallengeSession()
    session.start(selection({ mode: 'elimination', targetKills }), time(1), 'owner')
    fill(session, 1)
    let tick = 2
    for (let kills = 0; kills < targetKills - 1; kills++, tick++) {
      session.resolveDeaths([
        death(session.snapshot().active[0], tick),
      ], time(tick))
      fill(session, tick)
    }
    const active = session.snapshot().active
    const transition = session.resolveDeaths([
      death(active[3], tick, 9),
      death(active[1], tick, 2),
      death(active[2], tick, 2),
    ], time(tick))
    const state = session.snapshot()
    assert.equal(state.kills, targetKills)
    assert.equal(state.active.length, 0)
    assert.equal(transition.removed.filter(item => item.reason === 'killed').length, 3)
    assert.equal(transition.removed.filter(item => item.reason === 'completed').length, 7)
    assert.equal(state.result.completedAt, tick * h)
    assert.equal(state.result.elapsed, tick * h - h)
    assert.equal(transition.deficit, 0)
  }
})

test('cancel produces no score, next session changes all identities and repeated start is inert', () => {
  const session = new ChallengeSession()
  session.start(selection(), time(1), 'owner')
  fill(session, 1)
  const old = session.snapshot().active[0]
  session.start(selection({ mode: 'elimination' }), time(2), 'owner')
  assert.equal(session.snapshot().config.mode, 'shooting-test')
  session.cancel('respawn')
  assert.equal(session.snapshot().result, null)
  assert.equal(session.snapshot().status, 'idle')
  session.start(selection(), time(3), 'owner')
  fill(session, 3)
  assert.notEqual(session.snapshot().sessionId, old.sessionId)
  session.resolveDeaths([
    death(old, 3),
  ], time(3))
  assert.equal(session.snapshot().kills, 0)
})

function sceneCells(anchor = {
  position: [7, 9, -3],
  yaw: 0.7,
}) {
  return validateSectorCells(sectorCells(anchor), cell => cell.j > challengeRules.spawnOffsetRows + 1
    ? 4.25
    : null)
}
test('the sector shifts two full rows along respawn yaw and still requires floor validation', () => {
  const anchor = {
    position: [7, 9, -3],
    yaw: 0.7,
  }
  const cells = sectorCells(anchor)
  assert.ok(cells.length > 100)
  assert.equal(Math.min(...cells.map(cell => cell.j)), 3)
  assert.equal(Math.max(...cells.map(cell => cell.j)), 18)
  const originX = anchor.position[0] - 2 * Math.sin(anchor.yaw)
  const originZ = anchor.position[2] - 2 * Math.cos(anchor.yaw)
  for (const cell of cells) {
    assert.equal(cell.position, undefined, 'geometry alone must not guess a floor')
    for (const [x, z] of cell.corners) {
      const dx = x - originX
      const dz = z - originZ
      const r = Math.hypot(dx, dz)
      const dot = -dx * Math.sin(anchor.yaw) - dz * Math.cos(anchor.yaw)
      assert.ok(r > 0 && r <= 18 + 1e-9)
      assert.ok(dot >= r * Math.SQRT1_2 - 1e-9)
    }
    assert.ok(Math.abs(Math.hypot(cell.corners[0][0] - cell.corners[1][0], cell.corners[0][1] - cell.corners[1][1]) - 1) < 1e-9)
  }
  assert.throws(() => new SpawnGrid(cells), /scene-validated/)
  assert.throws(() => validateSectorCells(cells, null), /validation/)
  const valid = sceneCells(anchor)
  assert.ok(valid.every(cell => cell.position[1] === 4.25))
  assert.deepEqual(sectorCells(anchor), cells)
  assert.equal(challengeRules.angle, Math.PI / 2)
})

test('occupancy/diagonal protection overlap counts are independent and old callbacks cannot free new owners', () => {
  const cells = []
  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < 5; i++) {
      cells.push({
        cellId: `${i},${j}`,
        i,
        j,
        position: [i + 0.5, 2, j + 0.5],
      })
    }
  }
  const grid = new SpawnGrid(cells)
  grid.reset('a')
  const first = grid.allocateBatch('a', ['one'], () => 0)[0]
  const second = grid.allocateBatch('a', ['two'], () => 0)[0]
  assert.equal(first.cellId, '0,0')
  assert.equal(second.cellId, '2,0', 'orthogonal AND diagonal neighbors are excluded')
  assert.equal(grid.snapshot().protection.find(cell => cell.cellId === '1,0').count, 2)
  grid.retire(first, 0.5)
  assert.equal(grid.retire(first, 0.6), false, 'duplicate retirement cannot extend plan')
  grid.releaseDue(0.49)
  assert.equal(grid.snapshot().owners.length, 2)
  grid.releaseDue(0.5)
  assert.equal(grid.snapshot().protection.find(cell => cell.cellId === '1,0').count, 1)
  assert.equal(grid.release(first), false)
  grid.reset('b')
  const replacement = grid.allocateBatch('b', ['one'], () => 0)[0]
  assert.equal(grid.release(first), false)
  assert.equal(grid.snapshot().owners.length, 1)
  assert.equal(replacement.sessionId, 'b')
})

test('batch allocation is conflict-free/atomic, fixed randomness repeats, capacity needs a constructive buffered layout', () => {
  const grid = new SpawnGrid(sceneCells())
  assert.equal(grid.assertCapacity(10).length, 20)
  const run = () => {
    grid.reset('a')
    let index = 0
    const values = [0.2, 0.6, 0.1, 0.8, 0.3]
    return grid.allocateBatch('a', Array.from({ length: 10 }, (_, i) => `s${i}`), () => values[index++ % values.length])
  }
  const batch = run()
  assert.deepEqual(run(), batch)
  for (const a of batch) {
    for (const b of batch) {
      if (a !== b)
        assert.ok(Math.max(Math.abs(a.i - b.i), Math.abs(a.j - b.j)) >= 2)
    }
  }
  const tiny = new SpawnGrid([
    {
      cellId: 'a',
      i: 0,
      j: 0,
      position: [0, 0, 0],
    },
    {
      cellId: 'b',
      i: 1,
      j: 1,
      position: [1, 0, 1],
    },
  ])
  assert.throws(() => tiny.assertCapacity(1), GridCapacityError, 'two cells is not a valid two-body layout')
  tiny.reset('t')
  assert.throws(() => tiny.allocateBatch('t', ['one', 'two'], () => 0), GridCapacityError)
  assert.equal(tiny.snapshot().owners.length, 0, 'failed batch leaves no partial reservations')
  assert.throws(() => tiny.allocateBatch('t', ['one'], () => 1), /Random/)
  assert.equal(tiny.snapshot().owners.length, 0)
})
