import { Quaternion, Vector3 } from 'three/webgpu'
import { AnimationPlayer } from '../../engine/runtime/function/animation/index.js'
import { Component, GameObject, MeshComponent, TransformComponent } from '../../engine/runtime/function/framework/index.js'
import { BoneHitboxes } from './bone-hitboxes.js'
import { TrainingBotAudio } from './training-bot-audio.js'
import { createTrainingBotOutline } from './training-bot-outline.js'
import { loadTrainingBotSkins, trainingBotSkins } from './training-bot-skins.js'

const modelName = 'range-room:training-bot:model'
const hitboxesName = 'range-room:training-bot:hitboxes'
const modelUrl = '/targets/training-bot/range-training-bot.glb'
const hitboxesUrl = '/targets/training-bot/range-training-bot.hitboxes.json'
const up = new Vector3(0, 1, 0)

export class TrainingBotComponent extends Component {
  static requires = [TransformComponent, MeshComponent]
  static phases = ['fixed']

  #targets
  #hitboxes
  #animation
  #hitAudio
  #skin
  #regions
  #unregister
  #transform
  #reacting = false
  #lastRegion = null
  #hitCount = 0

  constructor({ root, clips, profile, targets, hitAudio = null, skin = 'purple' }) {
    super()
    this.#targets = targets
    this.#hitAudio = hitAudio
    this.#skin = skin
    this.#hitboxes = new BoneHitboxes(root, profile)
    this.#regions = profile.regions
    const actions = Object.fromEntries(Object.entries(this.#regions).map(([region, clip]) => [
      region,
      { clip, fade: 0 },
    ]))
    this.#animation = new AnimationPlayer({ root, clips, actions })
  }

  onAttach() {
    this.#transform = this.owner.requireComponent(TransformComponent)
    this.#unregister = this.#targets.register(this.owner.id, this)
  }

  trace(origin, direction, limit) {
    if (!this.enabled || !this.owner?.active)
      return null
    const hit = this.#hitboxes.trace(origin, direction, this.#transform, limit)
    return hit && { ...hit, surface: 'metal' }
  }

  react({ region }, { at } = {}) {
    if (!this.enabled || !this.owner?.active)
      return
    this.#animation.play(region, { restart: true })
    this.#lastRegion = region
    this.#hitCount++
    this.#reacting = true
    this.#hitAudio?.play({
      owner: this.owner.id,
      region,
      sequence: this.#hitCount,
      at,
    })
  }

  tick({ delta }) {
    if (this.#reacting && this.#animation.advance(delta).some(event => event.type === 'finished')) {
      this.#animation.stop()
      this.#reacting = false
    }
  }

  snapshot() {
    const current = this.#animation.snapshot().current
    return {
      id: this.owner.id,
      position: this.#transform.position.toArray(),
      skin: this.#skin,
      difficulty: trainingBotSkins[this.#skin].difficulty,
      difficultyLabel: trainingBotSkins[this.#skin].label,
      hitCount: this.#hitCount,
      lastRegion: this.#lastRegion,
      reaction: current && { clip: this.#regions[current.role], time: current.localTime },
    }
  }

  dispose() {
    if (this.disposed)
      return
    this.#unregister?.()
    if (this.owner)
      this.#hitAudio?.stop(this.owner.id)
    this.#animation.dispose()
    super.dispose()
  }
}

/** Templates are level-owned. Each GO owns its instance bones, playback and registration. */
export async function loadTrainingBotAssets({ resources, audio = null, signal }) {
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
    const clips = resources.get(modelName, 'gltf').animations
    skins = await loadTrainingBotSkins({ resources, signal })
    // Optional audio preloads independently and cannot block the model or reactions.
    hitAudio = audio
      ? new TrainingBotAudio({ audio, resources, signal })
      : null
    return {
      dispose,
      audioReady: hitAudio?.ready ?? Promise.resolve(),
      instantiate({ scene, targets, position, yaw = 0, scale = 1, skin = 'purple' }) {
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
        for (const mesh of meshes) {
          skins.apply(mesh, skin)
          outline.attach(mesh, trainingBotSkins[skin].outlineColor)
        }
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
