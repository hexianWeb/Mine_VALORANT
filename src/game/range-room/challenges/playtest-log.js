// Keep small scalar rows, never the combat facts (which may retain entire bone poses).
const historyLimit = 10
const rowLimit = 20000
const columns = [
  'schema',
  'run_id',
  'player_id',
  'input_layout',
  'started_utc',
  'rules_version',
  'damage_version',
  'mode',
  'difficulty',
  'goal',
  'armor',
  'ammo_policy',
  'event',
  'sim_ms',
  'wall_ms',
  'active_ms',
  'shot_id',
  'weapon',
  'magazine_after',
  'hit',
  'spawn_id',
  'cell_id',
  'region',
  'hp_damage',
  'armor_damage',
  'x',
  'y',
  'z',
  'reason',
  'shots',
  'misses',
  'kills',
  'head_kills',
  'score_kills',
  'dropped_rows',
  'kpm',
  'head_kill_rate',
  'miss_rate',
]

function csvCell(value) {
  const text = String(value ?? '')
  return /[",\r\n]/u.test(text)
    ? `"${text.replaceAll('"', '""')}"`
    : text
}

const trialColumns = [
  ...columns,
  'shot_phase',
  'outside_kills',
  'flow_kills',
  'flow_count',
  'first_flow_ms',
  'first_confirm_ms',
  'first_post_flow_shot_ms',
]

export class PlaytestLog {
  #run = null
  #history = []
  #choices = Object.freeze([])
  #unseen = new Set()

  get choices() { return this.#choices }

  start(sessionId, config, at, shot) {
    this.#run = {
      sessionId,
      at,
      startMs: performance.now(),
      pausedAt: null,
      pausedMs: 0,
      meta: {
        schema: config.mode === 'haoqi'
          ? 'range-playtest-v2'
          : 'range-playtest-v1',
        run_id: crypto.randomUUID(),
        started_utc: new Date().toISOString(),
        rules_version: config.rules.version,
        damage_version: config.rules.damageVersion,
        mode: config.mode,
        difficulty: config.mode === 'shooting-test'
          ? config.difficulty
          : '',
        goal: config.goal,
        armor: config.maxArmor,
        ammo_policy: shot.ammoPolicy,
      },
      rows: [],
      shots: 0,
      misses: 0,
      kills: 0,
      heads: 0,
      dropped: 0,
    }
    this.#unseen.clear()
    this.#row('run_start', at, { weapon: shot.definitionId }, this.#run.startMs)
  }

  #row(event, at, fields, now = performance.now()) {
    const r = this.#run
    if (r.rows.length >= rowLimit && event !== 'run_end') {
      r.dropped++
      return
    }
    r.rows.push({
      event,
      sim_ms: Math.round((at - r.at) * 1000),
      wall_ms: Math.round(now - r.startMs),
      active_ms: Math.round((r.pausedAt ?? now) - r.startMs - r.pausedMs),
      ...fields,
    })
    return r.rows.at(-1)
  }

  pause(paused, at) {
    const r = this.#run
    if (!r || paused === (r.pausedAt !== null))
      return
    const now = performance.now()
    if (paused) {
      r.pausedAt = now
    }
    else {
      r.pausedMs += now - r.pausedAt
      r.pausedAt = null
    }
    this.#row(paused ? 'pause' : 'resume', at, {}, now)
  }

  spawn(spawn) {
    this.#unseen.add(spawn.spawnId)
    const [x, y, z] = spawn.position
    this.#row('spawn', spawn.at, {
      spawn_id: spawn.spawnId,
      cell_id: spawn.cellId,
      x,
      y,
      z,
    })
  }

  observeView(presented, at, inView) {
    if (!this.#unseen.size || !inView || presented?.sessionId !== this.#run?.sessionId)
      return
    for (const spawn of presented.active) {
      if (this.#unseen.has(spawn.spawnId) && inView(spawn)) {
        this.#unseen.delete(spawn.spawnId)
        this.#row('first_in_view', at, { spawn_id: spawn.spawnId })
      }
    }
  }

  flowEvent(event, at, reason) {
    this.#row(event, at, { reason })
  }

  attack(result, removed, guided) {
    const r = this.#run
    if (!r || result.disposition === 'interaction' || !result.attackType)
      return
    const shot = { shot_id: `${result.sourceId}/${result.epoch}/${result.sequence}`, weapon: result.definitionId }
    if (guided !== undefined)
      shot.shot_phase = guided ? 'flow' : 'outside'
    const damage = result.damage.filter(d => d.sessionId === r.sessionId)
    const gun = result.attackType === 'ShotFired'
    if (gun) {
      r.shots++
      if (!damage.length)
        r.misses++
    }
    this.#row(gun ? 'shot' : 'melee', result.at, {
      ...shot,
      magazine_after: result.magazineAfter,
      hit: Number(!!damage.length),
    })
    for (const d of damage) {
      this.#row('damage', result.at, {
        ...shot,
        spawn_id: d.spawnId,
        region: d.region,
        hp_damage: d.healthDamage,
        armor_damage: d.armorDamage,
      })
    }
    for (const { reason, death } of removed) {
      if (reason === 'killed') {
        r.kills++
        if (gun && death.region === 'head')
          r.heads++
        this.#row('kill', result.at, { ...shot, spawn_id: death.spawnId, region: death.region })
      }
    }
  }

  remove(spawn, reason, at) {
    this.#unseen.delete(spawn.spawnId)
    if (reason === 'expired')
      this.#row('expire', at, { spawn_id: spawn.spawnId })
  }

  end(at, reason, scoreKills, trialSummary) {
    const r = this.#run
    if (!r)
      return
    const end = this.#row('run_end', at, {
      reason,
      shots: r.shots,
      misses: r.misses,
      kills: r.kills,
      head_kills: r.heads,
      score_kills: scoreKills,
      dropped_rows: r.dropped,
      ...trialSummary,
    })
    end.kpm = end.active_ms
      ? (60000 * r.kills / end.active_ms).toFixed(3)
      : null
    end.head_kill_rate = r.kills
      ? (r.heads / r.kills).toFixed(6)
      : null
    end.miss_rate = r.shots
      ? (r.misses / r.shots).toFixed(6)
      : null
    this.#history.unshift(r)
    this.#history.length = Math.min(this.#history.length, historyLimit)
    this.#choices = Object.freeze(this.#history.map(({ meta, rows }) => Object.freeze({
      id: meta.run_id,
      started: meta.started_utc,
      mode: meta.mode,
      kills: rows.at(-1).kills,
      reason: rows.at(-1).reason,
    })))
    this.#run = null
    this.#unseen.clear()
  }

  exportCsv(id, playerId = '', inputLayout = '') {
    const r = this.#history.find(item => item.meta.run_id === id)
    if (!r)
      return null
    if (playerId && !/^[a-z0-9][\w-]{0,31}$/iu.test(playerId))
      throw new RangeError('玩家编号限 1–32 位字母、数字、下划线或短横线，须以字母或数字开头')
    const fields = r.meta.mode === 'haoqi'
      ? trialColumns
      : columns
    const lines = r.rows.map((row) => {
      const record = {
        ...r.meta,
        player_id: playerId,
        input_layout: inputLayout,
        ...row,
      }
      return fields.map(key => csvCell(record[key])).join(',')
    })
    return {
      filename: `range-${playerId
        ? `${playerId}-`
        : ''}${r.meta.started_utc.replace(/[:.]/gu, '-')}-${id}.csv`,
      csv: `\uFEFF${fields.join(',')}\r\n${lines.join('\r\n')}\r\n`,
    }
  }
}
