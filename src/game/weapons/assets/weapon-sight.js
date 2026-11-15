import { mix, smoothstep, uniform, uv, vec2, vec3 } from 'three/tsl'
import { DoubleSide, Group, Mesh, MeshBasicNodeMaterial, PlaneGeometry } from 'three/webgpu'
import { Disposer } from '../../../engine/runtime/core/disposer.js'

const sightMount = 'light_scope_illuminated'
// The reference outline spans 208 × 154 px at 720p. The plane includes room for its glow.
const fieldWidth = 224
const fieldHeight = 170
const sights = {
  'odin/v1': {
    center: [0, 0.0766, 0.001],
    unitsPerPixel: 0.000778,
  },
  'phantom/v3': {
    center: [0, 0.0509, 0.001],
    unitsPerPixel: 0.0004501,
    replaceReticle: true,
  },
  'vandal/v1': {
    center: [0, 0.0011, 0.001],
    unitsPerPixel: 0.0005491,
    replaceReticle: true,
  },
}

function hideAuthoredReticle(root, socket, owned) {
  const body = root.getObjectByName('Weapon_Body')
  const source = body.geometry
  const joints = source.getAttribute('skinIndex')
  const weights = source.getAttribute('skinWeight')
  const reticleBones = new Set()
  socket.traverse(bone => reticleBones.add(body.skeleton.bones.indexOf(bone)))

  const reticleVertices = new Uint8Array(joints.count)
  for (let vertex = 0; vertex < joints.count; vertex++) {
    let reticleWeight = 0
    for (let channel = 0; channel < joints.itemSize; channel++) {
      if (reticleBones.has(joints.getComponent(vertex, channel)))
        reticleWeight += weights.getComponent(vertex, channel)
    }
    reticleVertices[vertex] = reticleWeight > 0.9999
  }

  // Keep the published mesh and its draw ranges intact. Collapse only triangles
  // bound entirely to the authored reticle's joints on this instance's geometry.
  const geometry = owned.add(source.clone())
  const { index } = geometry
  for (let i = 0; i < index.count; i += 3) {
    const first = index.getX(i)
    if (reticleVertices[first] && reticleVertices[index.getX(i + 1)] && reticleVertices[index.getX(i + 2)]) {
      index.setX(i + 1, first)
      index.setX(i + 2, first)
    }
  }
  body.geometry = geometry
  owned.add(() => {
    body.geometry = source
  })
}

function stroke(point, start, end, startStrength, endStrength) {
  const segment = end.sub(start)
  const fromStart = point.sub(start)
  const t = fromStart.dot(segment).div(segment.dot(segment)).clamp(0, 1)
  const distance = fromStart.sub(segment.mul(t)).length()
  const strength = smoothstep(0, 0.66, mix(startStrength, endStrength, t))
  const radius = mix(0.2, 1.25, strength)
  const line = smoothstep(radius.mul(0.72), radius.add(0.6), distance).oneMinus().mul(strength)
  const glow = smoothstep(1, 3.8, distance).oneMinus().mul(strength)
  return vec2(line, glow)
}

function brackets() {
  const point = uv().sub(0.5).mul(vec2(fieldWidth, fieldHeight)).abs()
  const top = vec2(53, 77)
  const side = vec2(104, 51)
  // Mirroring one chamfered corner leaves openings at the middle of all four sides.
  return stroke(point, vec2(25, 77), top, 0, 1)
    .max(stroke(point, top, side, 1, 1))
    .max(stroke(point, side, vec2(104, 22), 1, 0))
}

function projectionMaterial(aim) {
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    side: DoubleSide,
    forceSinglePass: true,
  })
  const outline = brackets()
  // Emissive values go through the same HDR composite and tone map as the viewmodel.
  material.colorNode = mix(vec3(1.7, 0.79, 0.055), vec3(28, 25, 0.087), outline.x)
  material.opacityNode = outline.x.max(outline.y.mul(0.34)).mul(smoothstep(0.5, 0.85, aim))
  return material
}

export function createWeaponSight(root, { weaponId, assetVersion }) {
  const profile = sights[`${weaponId}/${assetVersion}`]
  if (!profile)
    return null
  const socket = root.getObjectByName(sightMount)
  if (!socket?.isBone)
    throw new Error(`[WeaponAssets] Missing sight mount: ${sightMount}`)

  const { center, unitsPerPixel } = profile
  const sight = new Group()
  sight.name = 'Procedural weapon sight'
  sight.position.fromArray(center)
  const aim = uniform(0)
  const owned = new Disposer()
  try {
    if (profile.replaceReticle)
      hideAuthoredReticle(root, socket, owned)
    const geometry = owned.add(new PlaneGeometry(fieldWidth * unitsPerPixel, fieldHeight * unitsPerPixel))
    const projection = new Mesh(geometry, owned.add(projectionMaterial(aim)))
    projection.name = 'Sight projection'
    sight.add(projection)
    socket.add(sight)
    owned.add(() => sight.removeFromParent())
  }
  catch (error) {
    owned.dispose()
    throw error
  }
  return {
    setAim(value) { aim.value = value },
    dispose() { owned.dispose() },
  }
}
