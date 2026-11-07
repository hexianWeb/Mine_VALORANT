import { lights as selectiveLights } from 'three/tsl'
import * as THREE from 'three/webgpu'
import { pixelArtAlbedo } from './pixel-art-sampling.js'

export const roomGroundConfig = Object.freeze({
  tileSize: 1,
  clearance: 0.01,
  halfExtent: 8192,
  viewDistance: 4096,
  grassTint: 0x91BD59,
  skyIntensity: 1,
})

export const roomGroundTextures = Object.freeze([
  { name: 'range-room:ground-quartz', type: 'texture', url: '/textures/minecraft/quartz_bricks.png' },
  { name: 'range-room:ground-grass', type: 'texture', url: '/textures/minecraft/grass_block_top.png' },
])

/** Disjoint horizontal rectangles; world-space UVs keep a one-block grid across every seam. */
function surfaceGeometry(rectangles, height, tileSize) {
  const positions = []
  const normals = []
  const coordinates = []
  const indices = []
  for (const [minX, maxX, minZ, maxZ] of rectangles) {
    const start = positions.length / 3
    for (const [x, z] of [
      [minX, minZ],
      [minX, maxZ],
      [maxX, maxZ],
      [maxX, minZ],
    ]) {
      positions.push(x, height, z)
      normals.push(0, 1, 0)
      coordinates.push(x / tileSize, -z / tileSize)
    }
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(coordinates, 2))
  geometry.setIndex(indices)
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

/** Owns only added ground geometry/materials/samplers; the original room bounds stay independent. */
export function createRoomGround({ bounds, quartzTexture, grassTexture, environment, anisotropy = 16 }) {
  const settings = roomGroundConfig
  const roomBounds = bounds.clone()
  const size = roomBounds.getSize(new THREE.Vector3())
  if (roomBounds.isEmpty() || !roomBounds.min.toArray().concat(roomBounds.max.toArray()).every(Number.isFinite) || size.x <= 0 || size.z <= 0)
    throw new Error('[Room ground] A finite nonempty room footprint is required')
  const center = roomBounds.getCenter(new THREE.Vector3())
  const halfExtent = Math.max(settings.halfExtent, size.x, size.z)
  const height = roomBounds.min.y - settings.clearance
  const { min, max } = roomBounds
  const outer = {
    minX: center.x - halfExtent,
    maxX: center.x + halfExtent,
    minZ: center.z - halfExtent,
    maxZ: center.z + halfExtent,
  }
  const root = new THREE.Group()
  root.name = 'RangeRoomGround'
  root.userData.role = 'outdoor-ground'
  const maps = []
  const materials = []
  const makeSurface = (name, source, tint, rectangles) => {
    const map = source.clone()
    map.name = `${name}:repeat-1m`
    map.colorSpace = THREE.SRGBColorSpace
    map.wrapS = map.wrapT = THREE.RepeatWrapping
    map.magFilter = THREE.LinearFilter
    map.minFilter = THREE.LinearMipmapLinearFilter
    map.generateMipmaps = true
    map.mipmaps = []
    map.anisotropy = Math.max(1, Math.min(16, anisotropy))
    map.needsUpdate = true
    maps.push(map)
    const material = new THREE.MeshStandardNodeMaterial({
      color: tint,
      map,
      roughness: 1,
      metalness: 0,
      envMap: environment,
      envMapIntensity: settings.skyIntensity,
    })
    material.name = `outdoor-ground:${name}`
    material.colorNode = pixelArtAlbedo(map)
    // Outdoor sky lighting is independent of the indoor probes and ceiling fixtures.
    // Native PBR environment lighting and the shared GTAO still apply.
    material.lightsNode = selectiveLights([])
    material.userData = { roomMode: 'realtime', role: 'outdoor-ground', surface: name }
    materials.push(material)
    const mesh = new THREE.Mesh(surfaceGeometry(rectangles, height, settings.tileSize), material)
    mesh.name = `Ground_${name}`
    mesh.userData = { role: 'outdoor-ground', surface: name }
    root.add(mesh)
  }
  makeSurface('Quartz', quartzTexture, 0xFFFFFF, [
    [min.x, max.x, min.z, max.z],
  ])
  // Four bands form a ring: no coplanar grass underneath the quartz and no overlapping corners.
  makeSurface('Grass', grassTexture, settings.grassTint, [
    [
      outer.minX,
      outer.maxX,
      outer.minZ,
      min.z,
    ],
    [
      outer.minX,
      outer.maxX,
      max.z,
      outer.maxZ,
    ],
    [outer.minX, min.x, min.z, max.z],
    [max.x, outer.maxX, min.z, max.z],
  ])
  let disposed = false
  let enabled = true
  return {
    root,
    viewDistance: settings.viewDistance,
    setLightingEnabled(value) {
      enabled = !!value
      for (const material of materials)
        material.envMapIntensity = enabled ? settings.skyIntensity : 0
    },
    snapshot() {
      return {
        roomBounds: {
          min: roomBounds.min.toArray(),
          max: roomBounds.max.toArray(),
        },
        footprint: {
          min: [min.x, min.z],
          max: [max.x, max.z],
          size: [size.x, size.z],
        },
        height,
        clearance: settings.clearance,
        tileSize: settings.tileSize,
        outer,
        viewDistance: settings.viewDistance,
        grassTint: `#${settings.grassTint.toString(16)}`,
        skyIntensity: enabled ? settings.skyIntensity : 0,
        meshes: root.children.length,
        triangles: root.children.reduce((sum, mesh) => sum + mesh.geometry.index.count / 3, 0),
        textures: maps.map(map => ({
          name: map.name,
          width: map.image.width,
          height: map.image.height,
          wrapS: map.wrapS,
          wrapT: map.wrapT,
          anisotropy: map.anisotropy,
          mipmaps: map.generateMipmaps,
        })),
      }
    },
    dispose() {
      if (disposed)
        return
      disposed = true
      root.removeFromParent()
      for (const mesh of root.children)
        mesh.geometry.dispose()
      for (const material of materials)
        material.dispose()
      for (const map of maps)
        map.dispose()
      root.clear()
    },
  }
}
