import { immutableFact } from '../../combat/facts.js'
import { rangeDamageVersion } from '../../combat/fixed-damage.js'
import { durationTicks } from '../../weapons/weapon-logic.js'

export const defaultChallengeSelection = Object.freeze({
  mode: 'shooting-test',
  difficulty: 'easy',
  targetKills: 50,
  armor: 0,
})

export const challengeRules = immutableFact({
  version: rangeDamageVersion,
  opportunities: 30,
  concurrency: 10,
  cellSize: 1,
  radius: 18,
  angle: Math.PI / 2,
  windows: { easy: 2, medium: 1, hard: 0.5 },
  maxHealth: 100,
  spawnDelay: 0,
})

/** Selection only; callers cannot silently override the agreed geometry/health/concurrency. */
export function lockChallengeConfig(selection, fixedDelta) {
  if (!selection || Object.keys(selection).some(key => ![
    'mode',
    'difficulty',
    'targetKills',
    'armor',
  ].includes(key))) {
    throw new TypeError('[Challenge] Unsupported selection')
  }
  if (!['shooting-test', 'elimination'].includes(selection.mode)
    || !Object.hasOwn(challengeRules.windows, selection.difficulty)
    || ![50, 100].includes(selection.targetKills) || ![0, 50].includes(selection.armor)) {
    throw new RangeError('[Challenge] Invalid mode, difficulty, target count or armor')
  }
  if (!Number.isFinite(fixedDelta) || fixedDelta <= 0)
    throw new RangeError('[Challenge] Invalid fixedDelta')
  const ticks = Object.values(challengeRules.windows).map(seconds => durationTicks(seconds, fixedDelta))
  if (!(ticks[0] > ticks[1] && ticks[1] > ticks[2] && ticks[2] > 0))
    throw new RangeError('[Challenge] Fixed step collapses the three distinct windows')
  const shooting = selection.mode === 'shooting-test'
  return immutableFact({
    ...selection,
    rules: challengeRules,
    fixedDelta,
    concurrency: shooting ? 1 : challengeRules.concurrency,
    goal: shooting ? challengeRules.opportunities : selection.targetKills,
    windowTicks: shooting
      ? durationTicks(challengeRules.windows[selection.difficulty], fixedDelta)
      : null,
    maxHealth: challengeRules.maxHealth,
    maxArmor: selection.armor,
  })
}
