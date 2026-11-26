import { clone } from 'three/addons/utils/SkeletonUtils.js'
import { AnimationPlayer } from '../../engine/runtime/function/animation/index.js'
import { immutableFact } from '../combat/facts.js'

function advance(player, delta) {
  if (player.advance(delta).some(event => event.type === 'finished'))
    player.stop()
}

/** Separate mutable skeletons/clocks. Pending facts are reclaimed by the P cursor, not fixed ticks. */
export class TargetPoses {
  authorityRoot
  #visible
  #authority
  #authorityAt = 0
  #presentationAt = 0
  #pending = []
  #sequence = 0
  #regions
  #root
  #restPose
  #visibleBones = new Map()
  #bodyHideAt = null
  #visibleSpawn = null

  constructor(root, clips, regions) {
    this.#root = root
    this.authorityRoot = clone(root)
    this.#regions = regions
    const actions = Object.fromEntries(Object.entries(regions).map(([region, clip]) => [
      region,
      { clip, fade: 0 },
    ]))
    this.#authority = new AnimationPlayer({ root: this.authorityRoot, clips, actions })
    this.#visible = new AnimationPlayer({ root, clips, actions })
    this.#restPose = this.capture()
    root.traverse((node) => {
      if (node.isBone)
        this.#visibleBones.set(node.name, node)
    })
  }

  prepare(at) {
    if (!Number.isFinite(at) || at < this.#authorityAt)
      throw new RangeError('[TargetPoses] Authority time cannot go backwards')
    if (at !== this.#authorityAt)
      advance(this.#authority, at - this.#authorityAt)
    this.#authorityAt = at
  }

  record(fact) {
    this.prepare(fact.at)
    if (fact.type === 'TargetReacted')
      this.#authority.play(fact.region, { restart: true })
    if (['TargetSpawned', 'TargetRemoved', 'PracticeVisibilityChanged'].includes(fact.type))
      this.#authority.stop()
    const recorded = immutableFact({ ...fact, presentationSequence: ++this.#sequence })
    this.#pending.push(recorded)
    return recorded
  }

  capture() {
    const bones = []
    this.authorityRoot.traverse((node) => {
      if (node.isBone) {
        bones.push({
          name: node.name,
          position: node.position.toArray(),
          quaternion: node.quaternion.toArray(),
          scale: node.scale.toArray(),
        })
      }
    })
    return immutableFact(bones)
  }

  #hideBody(at) {
    if (this.#bodyHideAt !== null && at >= this.#bodyHideAt) {
      this.#root.visible = false
      this.#bodyHideAt = null
      this.#visibleSpawn = null
    }
  }

  #applyVisiblePose(pose) {
    for (const bone of pose) {
      const node = this.#visibleBones.get(bone.name)
      node.position.fromArray(bone.position)
      node.quaternion.fromArray(bone.quaternion)
      node.scale.fromArray(bone.scale)
    }
  }

  present(at, timeScale = 1) {
    if (!Number.isFinite(at) || at < this.#presentationAt)
      throw new RangeError('[TargetPoses] Presentation time cannot go backwards')
    const rate = Number.isFinite(timeScale) && timeScale >= 0
      ? timeScale
      : 1
    const due = []
    while (this.#pending.length && this.#pending[0].at <= at) {
      const fact = this.#pending.shift()
      this.#hideBody(fact.at)
      advance(this.#visible, Math.max(0, fact.at - this.#presentationAt) * rate)
      this.#presentationAt = Math.max(this.#presentationAt, fact.at)
      if (fact.type === 'TargetReacted')
        this.#visible.play(fact.region, { restart: true })
      if ([
        'TargetSpawned',
        'TargetRemoved',
        'TargetKilled',
        'PracticeVisibilityChanged',
      ].includes(fact.type)) {
        this.#visible.stop()
      }
      if (fact.type === 'TargetSpawned') {
        this.#applyVisiblePose(this.#restPose)
        this.#root.position.fromArray(fact.position)
        this.#root.quaternion.fromArray(fact.quaternion)
        this.#root.scale.fromArray(fact.scale)
        this.#root.visible = true
        this.#visibleSpawn = fact.spawnId
      }
      if (fact.type === 'TargetRemoved') {
        this.#root.visible = false
        this.#visibleSpawn = null
      }
      if (fact.type === 'PracticeVisibilityChanged')
        this.#root.visible = fact.enabled
      if (fact.type === 'TargetKilled') {
        this.#applyVisiblePose(fact.pose)
        this.#bodyHideAt = fact.bodyHideAt
      }
      due.push(fact)
    }
    advance(this.#visible, (at - this.#presentationAt) * rate)
    this.#presentationAt = at
    this.#hideBody(at)
    return due
  }

  clear() {
    this.#pending = []
    this.#authority.stop()
    this.#visible.stop()
    this.#applyVisiblePose(this.#restPose)
    this.#bodyHideAt = null
    this.#visibleSpawn = null
  }

  snapshot() {
    const describe = (player) => {
      const current = player.snapshot().current
      return current && { clip: this.#regions[current.role], time: current.localTime }
    }
    return immutableFact({
      authorityTime: this.#authorityAt,
      presentationTime: this.#presentationAt,
      authority: describe(this.#authority),
      presentation: describe(this.#visible),
      visible: this.#root.visible,
      visibleSpawn: this.#visibleSpawn,
      bodyHideAt: this.#bodyHideAt,
      pending: this.#pending.length,
    })
  }

  dispose() {
    this.#pending = []
    this.#authority.dispose()
    this.#visible.dispose()
    const skeletons = new Set()
    this.authorityRoot.traverse(node => node.isSkinnedMesh && skeletons.add(node.skeleton))
    for (const skeleton of skeletons) skeleton.dispose()
  }
}
