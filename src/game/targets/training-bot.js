import { Quaternion, Vector3 } from 'three/webgpu'
import { AnimationPlayer } from '../../engine/runtime/function/animation/index.js'
import { Component, GameObject, MeshComponent, TransformComponent } from '../../engine/runtime/function/framework/index.js'
import { BoneHitboxes } from './bone-hitboxes.js'

const modelName = 'range-room:training-bot:model'
const hitboxesName = 'range-room:training-bot:hitboxes'
const modelUrl = new URL('./assets/range-training-bot.glb', import.meta.url).href
const hitboxesUrl = new URL('./assets/range-training-bot.hitboxes.json', import.meta.url).href
const up = new Vector3(0, 1, 0)

export class TrainingBotComponent extends Component {
  static requires = [TransformComponent, MeshComponent]
  static phases = ['fixed']

  #targets
  #hitboxes
  #animation
  #regions
  #unregister
  #transform
  #reacting = false
  #lastRegion = null
  #hitCount = 0

  constructor({ root, clips, profile, targets }) {
    super()
    this.#targets = targets
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

  react({ region }) {
    if (!this.enabled || !this.owner?.active)
      return
    this.#animation.play(region, { restart: true })
    this.#lastRegion = region
    this.#hitCount++
    this.#reacting = true
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
      hitCount: this.#hitCount,
      lastRegion: this.#lastRegion,
      reaction: current && { clip: this.#regions[current.role], time: current.localTime },
    }
  }

  dispose() {
    this.#unregister?.()
    this.#animation.dispose()
    super.dispose()
  }
}

/** Templates are level-owned. Each GO owns its instance bones, playback and registration. */
export async function loadTrainingBotAssets({ resources, signal }) {
  const dispose = () => {
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
    return {
      dispose,
      instantiate({ scene, targets, position, yaw = 0, scale = 1 }) {
        const root = resources.instantiate(modelName)
        const skeletons = new Set()
        root.traverse((node) => {
          if (node.isSkinnedMesh) {
            skeletons.add(node.skeleton)
            node.castShadow = true
            node.receiveShadow = true
          }
        })
        const object = new GameObject({ name: 'Range training bot', mobility: 'static' })
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
          object.addComponent(new TrainingBotComponent({ root, clips, profile, targets }))
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
