import { Quaternion, Vector3 } from 'three/webgpu'
import { Component, GameObject, MeshComponent, TransformComponent } from '../../engine/runtime/function/framework/index.js'
import { fixedTime, immutableFact } from '../combat/facts.js'
import { fixedDamage, validateDamageProfile } from '../combat/fixed-damage.js'
import { BoneHitboxes } from './bone-hitboxes.js'
import { TargetCombat } from './target-combat.js'
import { TargetPoses } from './target-poses.js'
import { TrainingBotAudio } from './training-bot-audio.js'
import { createTrainingBotOutline } from './training-bot-outline.js'
import { loadTrainingBotSkins, trainingBotSkins } from './training-bot-skins.js'

const modelName = 'range-room:training-bot:model'
const hitboxesName = 'range-room:training-bot:hitboxes'
const modelUrl = '/targets/training-bot/range-training-bot.glb'
const hitboxesUrl = '/targets/training-bot/range-training-bot.hitboxes.json'
const up = new Vector3(0, 1, 0)
const skinByDifficulty = new Map(Object.entries(trainingBotSkins).map(([skin, { difficulty }]) => [difficulty, skin]))

export class TrainingBotComponent extends Component {
  static requires = [TransformComponent, MeshComponent]
  static phases = ['fixed', 'motion']

  #targets
  #hitboxes
  #poses
  #combat = new TargetCombat()
  #practice
  #practiceEnabled
  #hitAudio
  #skin
  #defaultSkin
  #applySkin
  #unregister
  #registerMovementObstacle
  #unregisterMovementObstacle

  #bodyBox = {
    min: [0, 0, 0],
    max: [0, 0, 0],
  }

  #transform
  #onKillPresented
  #readWorldTimeScale
  #lastRegion = null
  #hitCount = 0
  #initialSound
  #immediateExitSequence = 0

  constructor({ root, clips, profile, targets, hitAudio = null, skin = 'purple', applySkin, registerMovementObstacle, practice = true, onKillPresented = null, readWorldTimeScale = () => 1 }) {
    super()
    this.#targets = targets
    this.#hitAudio = hitAudio
    this.#skin = skin
    this.#defaultSkin = skin
    this.#applySkin = applySkin
    this.#registerMovementObstacle = registerMovementObstacle
    this.#practice = practice
    this.#practiceEnabled = practice
    this.#initialSound = practice
    this.#onKillPresented = onKillPresented
    this.#readWorldTimeScale = readWorldTimeScale
    root.visible = practice
    validateDamageProfile(profile)
    this.#poses = new TargetPoses(root, clips, profile.regions)
    try {
      this.#hitboxes = new BoneHitboxes(this.#poses.authorityRoot, profile)
    }
    catch (error) {
      this.#poses.dispose()
      throw error
    }
  }

  onAttach() {
    this.#transform = this.owner.requireComponent(TransformComponent)
    this.#unregister = this.#targets.register(this.owner.id, this)
    this.#unregisterMovementObstacle = this.#registerMovementObstacle?.(() => this.#readBodyBox())
  }

  trace(origin, direction, limit) {
    if (!this.#hittable)
      return null
    const hit = this.#hitboxes.trace(origin, direction, this.#transform, limit)
    return hit && { ...hit, surface: 'metal' }
  }

  captureIdentity() {
    const identity = this.#combat.identity
    return identity
      ? { sessionId: identity.sessionId, spawnId: identity.spawnId, cellId: identity.cellId }
      : {}
  }

  preparePose(context) {
    if (this.#hittable)
      this.#poses.prepare(fixedTime(context).fixedElapsed)
  }

  get #hittable() {
    return this.enabled && this.owner?.active && (this.#practice ? this.#practiceEnabled : this.#combat.eligible)
  }

  #readBodyBox() {
    if (!this.#hittable)
      return null
    const { position, scale } = this.#transform
    const { min, max } = this.#bodyBox
    const halfWidth = 0.38 * Math.max(scale.x, scale.z)
    min[0] = position.x - halfWidth
    min[1] = position.y
    min[2] = position.z - halfWidth
    max[0] = position.x + halfWidth
    max[1] = position.y + 2.4 * scale.y
    max[2] = position.z + halfWidth
    return this.#bodyBox
  }

  setPracticeEnabled(enabled, at) {
    if (!this.#practice || enabled === this.#practiceEnabled)
      return
    this.#practiceEnabled = enabled
    this.#initialSound = false
    this.#poses.record({ type: 'PracticeVisibilityChanged', enabled, at })
    if (!enabled)
      this.#hitAudio?.stop(this.owner.id)
  }

  activateSpawn(spawn, attributes, context) {
    this.#poses.prepare(fixedTime(context).fixedElapsed)
    this.#combat.activate(spawn, attributes)
    this.#practice = false
    this.#initialSound = false
    // Keep mesh mounting/release, but never let its latest Transform overwrite P placement.
    this.owner.requireComponent(MeshComponent).enabled = false
    const skin = this.#applySkin && attributes.mode === 'shooting-test'
      ? skinByDifficulty.get(attributes.difficulty) ?? this.#defaultSkin
      : this.#defaultSkin
    this.#poses.record({ type: 'TargetSpawned', ...spawn, skin })
    this.#lastRegion = null
    this.#transform.teleport(new Vector3().fromArray(spawn.position))
    this.#transform.quaternion.fromArray(spawn.quaternion)
    this.#transform.scale.fromArray(spawn.scale)
  }

  removeSpawn(at, reason = 'removed') {
    this.#combat.deactivate()
    return this.#poses.record({
      ...this.captureIdentity(),
      type: 'TargetRemoved',
      at,
      reason,
    })
  }

  invalidateSpawn(at, reason) {
    const visible = this.#poses.snapshot().visibleSpawn
    const needsExit = !!visible && this.#combat.eligible && this.#combat.identity?.spawnId === visible && reason !== 'unload'
    this.#combat.deactivate()
    this.#poses.clear()
    this.owner.requireComponent(MeshComponent).root.visible = false
    this.#hitAudio?.stop(this.owner.id)
    if (needsExit) {
      this.#hitAudio?.playLifecycle({
        owner: this.owner.id,
        entered: false,
        sequence: --this.#immediateExitSequence,
        at,
      })
    }
  }

  /** Kept as a local feedback operation; ShotTargets no longer has a second react path. */
  react({ region }, { at = this.#poses.snapshot().authorityTime, fixedTick = null, sourceId = null, epoch = null, sequence = null } = {}) {
    if (!this.enabled || !this.owner?.active)
      return
    const fact = this.#poses.record({
      ...this.captureIdentity(),
      type: 'TargetReacted',
      region,
      at,
      targetId: this.owner.id,
      fixedTick,
      sourceId,
      epoch,
      sequence,
    })
    this.#lastRegion = region
    this.#hitCount++
    return fact
  }

  prepareDamage(entries, shot, context) {
    if (!this.#hittable)
      return null
    if (!this.#practice)
      return this.#combat.prepareDamage(entries, shot, context)
    // Free practice keeps the original non-lethal reactions.
    for (const entry of entries) fixedDamage(shot.definitionId, entry.impact.region)
    return immutableFact({ practice: true, entries })
  }

  commitDamage(plan, shot, time) {
    if (!plan.practice && !this.#combat.commitDamage(plan))
      return { damage: [], deaths: [], reactions: [] }
    const damage = plan.damage ?? []
    if (plan.lethal) {
      const seedText = `${shot.sourceId}/${shot.epoch}/${shot.sequence}/${plan.identity.spawnId}`
      let seed = 2166136261
      for (const char of seedText) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0
      const death = this.#poses.record({
        ...plan.identity,
        type: 'TargetKilled',
        targetId: this.owner.id,
        sourceId: shot.sourceId,
        epoch: shot.epoch,
        sequence: shot.sequence,
        definitionId: shot.definitionId,
        pelletIndex: plan.lethal.pelletIndex,
        region: plan.lethal.region,
        fixedTick: time.fixedTick,
        at: time.fixedElapsed,
        position: this.#transform.position.toArray(),
        impact: plan.lethal.impact,
        quaternion: this.#transform.quaternion.toArray(),
        scale: this.#transform.scale.toArray(),
        pose: this.#poses.capture(),
        presentationSeed: seed,
        bodyHideAt: plan.identity.bodyHideTicks
          ? (time.fixedTick + plan.identity.bodyHideTicks) * time.fixedDelta
          : null,
      })
      return {
        damage,
        deaths: [death],
        reactions: [],
      }
    }
    const impacts = plan.practice
      ? plan.entries.map(entry => entry.impact)
      : plan.damage.map(hit => hit.impact)
    const nearest = impacts.reduce((a, b) => !a || b.distance < a.distance
      ? b
      : a, null)
    const reaction = this.react(nearest, {
      at: time.fixedElapsed,
      fixedTick: time.fixedTick,
      sourceId: shot.sourceId,
      epoch: shot.epoch,
      sequence: shot.sequence,
    })
    return {
      damage,
      deaths: [],
      reactions: reaction
        ? [reaction]
        : [],
    }
  }

  tick({ phase, time }) {
    if (phase === 'fixed') {
      this.preparePose(time)
    }
    else if (phase === 'motion') {
      const worldTimeScale = this.#readWorldTimeScale?.() ?? 1
      if (this.#initialSound && this.#hitAudio?.canPlayInitial) {
        this.#initialSound = false
        this.#hitAudio.playLifecycle({
          owner: this.owner.id,
          entered: true,
          sequence: 0,
          at: time.presentationTime,
          timeScale: worldTimeScale,
        })
      }
      for (const fact of this.#poses.present(time.presentationTime, worldTimeScale)) {
        if (fact.type === 'TargetSpawned' && fact.skin !== this.#skin) {
          this.#applySkin(fact.skin)
          this.#skin = fact.skin
        }
        if (fact.type === 'TargetKilled') {
          this.#onKillPresented?.(fact, time.presentationTime)
        }
        else if (fact.type === 'TargetReacted') {
          this.#hitAudio?.play({
            owner: this.owner.id,
            region: fact.region,
            sequence: fact.presentationSequence,
            at: fact.at,
            timeScale: worldTimeScale,
          })
        }
        else if (['TargetSpawned', 'TargetRemoved', 'PracticeVisibilityChanged'].includes(fact.type)) {
          this.#hitAudio?.playLifecycle({
            owner: this.owner.id,
            entered: fact.type === 'TargetSpawned' || fact.enabled === true,
            sequence: fact.presentationSequence,
            at: fact.at,
            timeScale: worldTimeScale,
          })
        }
      }
    }
  }

  snapshot() {
    const poses = this.#poses.snapshot()
    return {
      id: this.owner.id,
      position: this.#transform.position.toArray(),
      skin: this.#skin,
      difficulty: trainingBotSkins[this.#skin].difficulty,
      difficultyLabel: trainingBotSkins[this.#skin].label,
      hitCount: this.#hitCount,
      lastRegion: this.#lastRegion,
      reaction: poses.authority,
      combat: this.#combat.snapshot(),
      poses,
    }
  }

  dispose() {
    if (this.disposed)
      return
    this.#unregister?.()
    this.#unregisterMovementObstacle?.()
    if (this.owner)
      this.#hitAudio?.stop(this.owner.id)
    this.#poses.dispose()
    super.dispose()
  }
}

/** Templates are level-owned. Each GO owns its instance bones, playback and registration. */
export async function loadTrainingBotAssets({ resources, audio = null, registerMovementObstacle, signal }) {
  const outline = createTrainingBotOutline()
  let hitAudio = null
  let skins = null
  const dispose = () => {
    hitAudio?.dispose()
    outline.dispose()
    skins?.dispose()
    resources.unload(modelName)
    resources.unload(hitboxesName)
  }
  try {
    await resources.load([
      { name: hitboxesName, type: 'json', url: hitboxesUrl },
    ], { signal })
    const profile = resources.get(hitboxesName, 'json')
    if (profile?.asset?.uri !== 'range-training-bot.glb' || !/^[a-f0-9]{64}$/u.test(profile.asset.sha256))
      throw new Error('[Training bot] Missing GLB identity in the hitbox profile')
    await resources.load([
      {
        name: modelName,
        type: 'gltf',
        url: modelUrl,
        options: { sha256: profile.asset.sha256 },
      },
    ], { signal })
    const { scene: template, animations: clips } = resources.get(modelName, 'gltf')
    template.updateMatrixWorld(true)
    const aimPoints = ['head', 'chest'].map((region) => {
      const part = profile.parts.find(part => part.region === region)
      const bone = template.getObjectByName(part.bone)
      const center = bone.localToWorld(new Vector3().fromArray(part.center))
      return template.worldToLocal(center).toArray()
    })
    skins = await loadTrainingBotSkins({ resources, signal })
    // Optional audio preloads independently and cannot block the model or reactions.
    hitAudio = audio
      ? new TrainingBotAudio({ audio, resources, signal })
      : null
    return {
      dispose,
      audioReady: hitAudio?.ready ?? Promise.resolve(),
      spawnGeometry: { bounds: profile.broadphase, aimPoints },
      setFlowGlow(value) {
        outline.setFlowGlow(value)
      },
      instantiate({ scene, targets, position, yaw = 0, scale = 1, skin = 'purple', practice = true, onKillPresented = null, readWorldTimeScale = () => 1 }) {
        if (!Object.hasOwn(trainingBotSkins, skin))
          throw new Error(`[Training bot] Unknown skin: ${skin}`)
        const root = resources.instantiate(modelName)
        const skeletons = new Set()
        const meshes = []
        root.traverse((node) => {
          if (node.isSkinnedMesh) {
            meshes.push(node)
            skeletons.add(node.skeleton)
            node.castShadow = true
            node.receiveShadow = true
          }
        })
        const applySkins = meshes.map((mesh) => {
          const source = mesh.material
          skins.apply(mesh, skin, source)
          const applyOutline = outline.attach(mesh, trainingBotSkins[skin].outlineColor)
          return (nextSkin) => {
            skins.apply(mesh, nextSkin, source)
            applyOutline(trainingBotSkins[nextSkin].outlineColor)
          }
        })
        const object = new GameObject({ name: `Range training bot (${skin})`, mobility: 'static' })
        object.addComponent(new TransformComponent({
          position: new Vector3().fromArray(position),
          quaternion: new Quaternion().setFromAxisAngle(up, yaw),
          scale: new Vector3().setScalar(scale),
        }))
        object.addComponent(new MeshComponent({
          root,
          scene,
          release: () => {
            for (const skeleton of skeletons) skeleton.dispose()
          },
        }))
        try {
          object.addComponent(new TrainingBotComponent({
            root,
            clips,
            profile,
            targets,
            hitAudio,
            skin,
            registerMovementObstacle,
            applySkin: (nextSkin) => {
              for (const apply of applySkins) apply(nextSkin)
            },
            practice,
            onKillPresented,
            readWorldTimeScale,
          }))
        }
        catch (error) {
          object.dispose()
          throw error
        }
        return object
      },
    }
  }
  catch (error) {
    dispose()
    throw error
  }
}
