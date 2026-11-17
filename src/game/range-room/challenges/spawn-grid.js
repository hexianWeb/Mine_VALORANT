import { identifier, immutableFact } from '../../combat/facts.js'
import { challengeRules } from './config.js'

export class GridCapacityError extends Error {}

/** Geometric candidates only. No guessed floor height or claim about scene validity. */
export function sectorCells({ position, yaw }) {
  if (!Array.isArray(position) || position.length !== 3 || !position.every(Number.isFinite) || !Number.isFinite(yaw))
    throw new TypeError('[Grid] Expected the configured respawn anchor')
  const { cellSize: g, radius, spawnOffsetRows } = challengeRules
  const offset = spawnOffsetRows * g
  const forward = [-Math.sin(yaw), -Math.cos(yaw)]
  const right = [
    Math.cos(yaw),
    -Math.sin(yaw),
  ]
  const world = (x, z) => {
    const depth = z + offset
    return [position[0] + x * right[0] + depth * forward[0], position[2] + x * right[1] + depth * forward[1]]
  }
  const inside = (x, z) => Math.hypot(x, z) > 0 && Math.hypot(x, z) <= radius + 1e-10 && z + 1e-10 >= Math.abs(x)
  const cells = []
  const extent = Math.ceil(radius / g)
  for (let j = 0; j < extent; j++) {
    const row = j + spawnOffsetRows
    for (let i = -extent; i < extent; i++) {
      const corners = [
        [i * g, j * g],
        [(i + 1) * g, j * g],
        [(i + 1) * g, (j + 1) * g],
        [i * g, (j + 1) * g],
      ]
      if (!corners.every(([x, z]) => inside(x, z)))
        continue
      cells.push({
        cellId: `${i},${row}`,
        i,
        j: row,
        center: world((i + 0.5) * g, (j + 0.5) * g),
        corners: corners.map(([x, z]) => world(x, z)),
      })
    }
  }
  return immutableFact(cells)
}

/** Validator must check full target pose envelope, floor, obstacles, player and visibility. */
export function validateSectorCells(cells, validate) {
  if (typeof validate !== 'function')
    throw new TypeError('[Grid] Scene validation is required before allocating')
  return immutableFact(cells.flatMap((cell) => {
    const floorY = validate(cell)
    return Number.isFinite(floorY) && typeof floorY === 'number'
      ? [
          {
            ...cell,
            position: [cell.center[0], floorY, cell.center[1]],
          },
        ]
      : []
  }))
}

const adjacent = (a, b) => Math.max(Math.abs(a.i - b.i), Math.abs(a.j - b.j)) < 2
const parity = value => ((value % 2) + 2) % 2

/** Level-local occupancy and reference-counted king-neighborhood protection. */
export class SpawnGrid {
  #cells
  #sessionId = null
  #owners = new Map()
  #blocked = new Map()
  #at = 0

  constructor(cells) {
    const ids = new Set()
    const coords = new Set()
    for (const cell of cells) {
      identifier(cell.cellId, 'cellId')
      if (ids.has(cell.cellId) || coords.has(`${cell.i},${cell.j}`) || !Number.isSafeInteger(cell.i) || !Number.isSafeInteger(cell.j)
        || !Array.isArray(cell.position) || cell.position.length !== 3 || !cell.position.every(Number.isFinite)) {
        throw new TypeError('[Grid] Expected unique, scene-validated complete cells')
      }
      ids.add(cell.cellId)
      coords.add(`${cell.i},${cell.j}`)
    }
    this.#cells = new Map(immutableFact(cells).map(cell => [cell.cellId, cell]))
  }

  reset(sessionId) {
    identifier(sessionId, 'sessionId')
    this.#sessionId = sessionId
    this.#owners.clear()
    this.#blocked.clear()
    this.#at = 0
  }

  /** Bounded proof of an independent layout, INCLUDING a simultaneous replacement buffer. */
  assertCapacity(concurrency, retirementBuffer = concurrency, budget = 50000) {
    if (!Number.isSafeInteger(concurrency) || concurrency < 1 || !Number.isSafeInteger(retirementBuffer)
      || retirementBuffer < concurrency || !Number.isSafeInteger(budget) || budget < 1) {
      throw new RangeError('[Grid] Capacity needs concurrency plus a full retirement batch')
    }
    const count = concurrency + retirementBuffer
    const cells = [
      ...this.#cells.values(),
    ]
    // Common complete/irregular grids have a cheap constructive proof.
    for (let x = 0; x < 2; x++) {
      for (let z = 0; z < 2; z++) {
        const witness = cells.filter(cell => parity(cell.i) === x && parity(cell.j) === z)
        if (witness.length >= count)
          return immutableFact(witness.slice(0, count).map(cell => cell.cellId))
      }
    }
    let visits = 0
    const find = (available, chosen) => {
      if (chosen.length === count)
        return chosen
      if (available.length + chosen.length < count)
        return null
      if (++visits > budget)
        throw new GridCapacityError('[Grid] Capacity proof budget exhausted; start blocked, N/g unchanged')
      for (let index = 0; index <= available.length - (count - chosen.length); index++) {
        const cell = available[index]
        const result = find(available.slice(index + 1).filter(other => !adjacent(cell, other)), [...chosen, cell])
        if (result)
          return result
      }
      return null
    }
    const witness = find(cells, [])
    if (!witness)
      throw new GridCapacityError(`[Grid] Cannot fit N=${concurrency}, g=1 with retirement buffer=${retirementBuffer}`)
    return immutableFact(witness.map(cell => cell.cellId))
  }

  #neighbors(cell) {
    const result = []
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) result.push(`${cell.i + di},${cell.j + dj}`)
    }
    return result
  }

  #add(owner) {
    this.#owners.set(owner.spawnId, owner)
    for (const key of this.#neighbors(this.#cells.get(owner.cellId)))
      this.#blocked.set(key, (this.#blocked.get(key) ?? 0) + 1)
  }

  /** Select each currently legal cell uniformly; stage the WHOLE batch before any mutation. */
  allocateBatch(sessionId, spawnIds, random, excludeCellIds = []) {
    if (sessionId !== this.#sessionId || !spawnIds.length || new Set(spawnIds).size !== spawnIds.length
      || spawnIds.some(id => typeof id !== 'string' || !id.length || this.#owners.has(id)) || typeof random !== 'function') {
      throw new TypeError('[Grid] Invalid batch identity or random source')
    }
    const excluded = new Set(excludeCellIds)
    const staged = []
    for (const spawnId of spawnIds) {
      const legal = [
        ...this.#cells.values(),
      ].filter(cell => !excluded.has(cell.cellId)
        && !this.#blocked.has(`${cell.i},${cell.j}`) && !staged.some(owner => adjacent(cell, this.#cells.get(owner.cellId))))
      if (!legal.length)
        throw new GridCapacityError('[Grid] Replacement capacity exhausted; abort rather than wait or overlap')
      const sample = random()
      if (!Number.isFinite(sample) || sample < 0 || sample >= 1)
        throw new RangeError('[Grid] Random samples must be in [0, 1)')
      staged.push({
        sessionId,
        spawnId,
        cellId: legal[Math.floor(sample * legal.length)].cellId,
        releaseAt: null,
      })
    }
    for (const owner of staged) this.#add(owner)
    return immutableFact(staged.map(owner => ({
      ...owner,
      ...this.#cells.get(owner.cellId),
    })))
  }

  retire({ sessionId, spawnId }, releaseAt) {
    const owner = this.#owners.get(spawnId)
    if (sessionId !== this.#sessionId || owner?.sessionId !== sessionId)
      return false
    if (!Number.isFinite(releaseAt) || releaseAt < this.#at)
      throw new RangeError('[Grid] Invalid fixed body-hide plan')
    if (owner.releaseAt !== null)
      return false
    owner.releaseAt = releaseAt
    return true
  }

  release({ sessionId, spawnId }) {
    const owner = this.#owners.get(spawnId)
    if (sessionId !== this.#sessionId || owner?.sessionId !== sessionId)
      return false
    this.#owners.delete(spawnId)
    for (const key of this.#neighbors(this.#cells.get(owner.cellId))) {
      const count = this.#blocked.get(key) - 1
      if (count)
        this.#blocked.set(key, count)
      else
        this.#blocked.delete(key)
    }
    return true
  }

  releaseDue(at) {
    if (!Number.isFinite(at) || at < this.#at)
      throw new RangeError('[Grid] Fixed release time cannot go backwards')
    this.#at = at
    for (const owner of this.#owners.values()) {
      if (owner.releaseAt !== null && at >= owner.releaseAt)
        this.release(owner)
    }
  }

  snapshot() {
    return immutableFact({
      sessionId: this.#sessionId,
      cells: this.#cells.size,
      owners: [
        ...this.#owners.values(),
      ],
      protection: [...this.#blocked].map(([cellId, count]) => ({ cellId, count })),
    })
  }
}
