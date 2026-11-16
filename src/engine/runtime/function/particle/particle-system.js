import { softParticles } from 'three/addons/tsl/utils/SoftParticles.js'
import { attribute, cameraWorldMatrix, float, Fn, instanceIndex, positionGeometry, rotate, smoothstep, uniform, uv, vec3 } from 'three/tsl'
import { BoxGeometry, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, MeshBasicNodeMaterial, PlaneGeometry } from 'three/webgpu'
import { Disposer } from '../../core/disposer.js'

const shapeIds = {
  streak: 0,
  cube: 1,
  puff: 2,
  tracer: 3,
}
const attributeSizes = {
  particleOrigin: 3,
  particleVelocity: 3,
  particleParams: 4, // Birth, lifetime, size, gravity.
  particleColor: 4, // Linear RGB and shape ID.
  particleStretch: 1,
}

function streakOffset(velocity, size, travel = null) {
  const speed = velocity.length()
  const direction = speed.greaterThan(0.00001).select(velocity, vec3(1, 0, 0)).normalize()
  const up = direction.y.abs().greaterThan(0.95).select(vec3(1, 0, 0), vec3(0, 1, 0))
  const side = direction.cross(up).normalize()
  const length = speed.mul(travel ? 0.012 : 0.026).max(size.mul(1.5))
  // Tracer position is its HEAD. Its tail cannot extend behind its launch point,
  // and no vertex can advance past the head (or the terminal impact).
  const along = travel
    ? positionGeometry.x.sub(0.5).mul(length.min(travel))
    : positionGeometry.x.mul(length)
  return direction.mul(along)
    .add(side.mul(positionGeometry.y.mul(size)))
    .add(direction.cross(side).mul(positionGeometry.z.mul(size)))
}

function cubeOffset(age, size) {
  const stretch = attribute('particleStretch', 'float')
  const spin = float(instanceIndex).mul(0.618).fract().mul(2 * Math.PI).add(age.mul(12))
  const angles = vec3(spin, spin.mul(0.73), spin.mul(0.37))
  return rotate(positionGeometry.mul(vec3(stretch, 1, 1)), angles).mul(size)
}

function createMaterial(clock, soft) {
  const material = new MeshBasicNodeMaterial({
    transparent: soft,
    depthWrite: !soft,
    toneMapped: false,
  })
  const origin = attribute('particleOrigin', 'vec3')
  const velocity = attribute('particleVelocity', 'vec3')
  const params = attribute('particleParams', 'vec4')
  const color = attribute('particleColor', 'vec4')
  const elapsed = clock.sub(params.x)
  const life = params.y.max(0.00001)
  const progress = elapsed.div(life).clamp(0, 1)
  material.positionNode = Fn(() => {
    const age = elapsed.clamp(0, life).toConst()
    const alive = elapsed.greaterThanEqual(0).and(elapsed.lessThan(life))
    const gravity = vec3(0, params.w.negate(), 0)
    const center = origin.add(velocity.mul(age)).add(gravity.mul(age.mul(age).mul(0.5)))
    const size = params.z
    let offset
    if (soft) {
      const right = cameraWorldMatrix.element(0).xyz
      const up = cameraWorldMatrix.element(1).xyz
      const spread = size.mul(progress.mul(1.7).add(1))
      offset = right.mul(positionGeometry.x).add(up.mul(positionGeometry.y)).mul(spread)
    }
    else {
      const spark = streakOffset(velocity.add(gravity.mul(age)), size)
      const chip = cubeOffset(age, size)
      const tracer = streakOffset(velocity, size, velocity.length().mul(age))
      const debris = color.w.lessThan(0.5).select(spark, chip).mul(progress.oneMinus())
      offset = color.w.greaterThan(2.5).select(tracer, debris)
    }
    return center.add(offset.mul(alive.select(1, 0)))
  })()
  material.colorNode = color.rgb
  if (soft) {
    const radius = uv().sub(0.5).length()
    const edge = smoothstep(0.08, 0.5, radius).oneMinus()
    const envelope = smoothstep(0, 0.08, progress).mul(progress.oneMinus().pow(1.35))
    material.opacityNode = softParticles({
      opacity: edge.mul(envelope).mul(0.72),
      distance: 0.16,
    })
  }
  return material
}

function createBatch(owned, scene, clock, capacity, soft) {
  const geometry = owned.add(soft
    ? new PlaneGeometry(1, 1)
    : new BoxGeometry(1, 1, 1))
  const material = owned.add(createMaterial(clock, soft))
  const attributes = {}
  for (const [name, size] of Object.entries(attributeSizes)) {
    attributes[name] = new InstancedBufferAttribute(new Float32Array(capacity * size), size).setUsage(DynamicDrawUsage)
    geometry.setAttribute(name, attributes[name])
  }
  const mesh = owned.add(new InstancedMesh(geometry, material, capacity))
  mesh.name = soft ? 'Particle puffs' : 'Particle solids'
  mesh.frustumCulled = false
  mesh.visible = false
  mesh.count = 0
  // Positions are evaluated by the vertex shader, outside CPU raycasts.
  mesh.raycast = () => {}
  owned.add(() => mesh.removeFromParent())
  scene.add(mesh)
  return {
    mesh,
    attributes,
    written: 0,
    visibleUntil: -Infinity,
  }
}

function writeParticle(batch, particle, capacity) {
  const { particleOrigin, particleVelocity, particleParams, particleColor, particleStretch } = batch.attributes
  const slot = batch.written % capacity
  particleOrigin.setXYZ(slot, ...particle.origin)
  particleVelocity.setXYZ(slot, ...particle.velocity)
  particleParams.setXYZW(slot, particle.born, particle.life, particle.size, particle.gravity)
  particleColor.setXYZW(slot, ...particle.color, shapeIds[particle.shape])
  particleStretch.setX(slot, particle.stretch ?? 1)
  batch.written++
  batch.visibleUntil = Math.max(batch.visibleUntil, particle.born + particle.life)
}

function publishWrites(batch, previous, capacity) {
  const count = Math.min(batch.written - previous, capacity)
  if (!count)
    return
  const first = (batch.written - count) % capacity
  const firstCount = Math.min(count, capacity - first)
  for (const attribute of Object.values(batch.attributes)) {
    const size = attribute.itemSize
    attribute.addUpdateRange(first * size, firstCount * size)
    if (firstCount < count)
      attribute.addUpdateRange(0, (count - firstCount) * size)
    attribute.needsUpdate = true
  }
  batch.mesh.count = Math.min(batch.written, capacity)
}

/**
 * Scene-owned effect geometry. Capacity is per batch, and positions, sizes and
 * gravity use world units. Colors are linear RGB and may exceed 1 for sparks.
 */
export function createParticleSystem({ scene, capacity = 1024 }) {
  if (!Number.isSafeInteger(capacity) || capacity < 1)
    throw new RangeError('[Particles] Capacity must be a positive integer')
  const owned = new Disposer()
  const clock = uniform(0)
  let batches
  try {
    batches = [
      createBatch(owned, scene, clock, capacity, false),
      createBatch(owned, scene, clock, capacity, true),
    ]
  }
  catch (error) {
    owned.dispose()
    throw error
  }
  const [solid, soft] = batches
  const clear = () => {
    for (const batch of batches) {
      batch.written = 0
      batch.visibleUntil = -Infinity
      batch.mesh.count = 0
      batch.mesh.visible = false
      for (const attribute of Object.values(batch.attributes)) attribute.clearUpdateRanges()
    }
  }
  return {
    emit(particles) {
      if (owned.disposed)
        return
      if (particles.some(particle => !Object.hasOwn(shapeIds, particle.shape)))
        throw new RangeError('[Particles] Unsupported particle shape')
      const solidStart = solid.written
      const softStart = soft.written
      for (const particle of particles) {
        writeParticle(particle.shape === 'puff'
          ? soft
          : solid, particle, capacity)
      }
      publishWrites(solid, solidStart, capacity)
      publishWrites(soft, softStart, capacity)
    },
    flush({ presentationTime }) {
      clock.value = presentationTime
      for (const batch of batches)
        batch.mesh.visible = batch.mesh.count > 0 && presentationTime < batch.visibleUntil
    },
    clear,
    snapshot() {
      let alive = 0
      for (const { mesh, attributes: { particleParams } } of batches) {
        for (let index = 0; index < mesh.count; index++) {
          const age = clock.value - particleParams.getX(index)
          if (age >= 0 && age < particleParams.getY(index))
            alive++
        }
      }
      return { capacity, written: solid.written + soft.written, alive }
    },
    dispose() {
      clear()
      owned.dispose()
    },
  }
}
