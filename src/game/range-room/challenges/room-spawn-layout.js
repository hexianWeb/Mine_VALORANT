import { Box3, Raycaster, Triangle, Vector3 } from 'three/webgpu'
import { characterBox } from '../../../engine/runtime/function/character/character-motion.js'
import { intersectRayBox } from '../../../engine/runtime/function/physics/ray-box.js'
import { immutableFact } from '../../combat/facts.js'
import { sectorCells, validateSectorCells } from './spawn-grid.js'

const tolerance = 0.001
const down = new Vector3(0, -1, 0)

function onFootprint(box, x, z) {
  return x >= box.min[0] - tolerance && x <= box.max[0] + tolerance
    && z >= box.min[2] - tolerance && z <= box.max[2] + tolerance
}

/** Cover each x strip of the footprint with the union of coplanar floor boxes. */
function supported(floors, y, minX, maxX, minZ, maxZ) {
  const candidates = floors.filter(b => Math.abs(y - b.max[1]) <= tolerance
    && b.min[0] < maxX && b.max[0] > minX && b.min[2] < maxZ && b.max[2] > minZ)
    .sort((a, b) => a.min[2] - b.min[2])
  const clip = x => Math.min(maxX, Math.max(minX, x))
  const edges = [
    minX,
    maxX,
    ...candidates.flatMap(box => [
      clip(box.min[0]),
      clip(box.max[0]),
    ]),
  ].sort((a, b) => a - b)
  for (let i = 1; i < edges.length; i++) {
    if (edges[i] - edges[i - 1] <= tolerance)
      continue
    const x = (edges[i] + edges[i - 1]) / 2
    let covered = minZ
    for (const box of candidates) {
      if (onFootprint(box, x, covered))
        covered = Math.max(covered, box.max[2])
      if (covered >= maxZ - tolerance)
        break
    }
    if (covered < maxZ - tolerance)
      return false
  }
  return true
}

function collectOpaqueMeshes(root) {
  const meshes = []
  root.updateWorldMatrix(true, true)
  root.traverseVisible((mesh) => {
    if (!mesh.isMesh || mesh.material.transparent)
      return
    const geometry = mesh.geometry
    if (!geometry.boundingBox)
      geometry.computeBoundingBox()
    meshes.push({
      mesh,
      bounds: geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld),
    })
  })
  return meshes
}

function intersectsMesh(body, entry, triangle, triangleBounds) {
  const { mesh } = entry
  const { index, attributes } = mesh.geometry
  // Reuse the transformed vertices for all cells that overlap this mesh.
  const position = entry.worldPosition ??= attributes.position.clone().applyMatrix4(mesh.matrixWorld)
  const vertices = [triangle.a, triangle.b, triangle.c]
  const count = index?.count ?? position.count
  for (let i = 0; i < count; i += 3) {
    for (let j = 0; j < 3; j++) {
      vertices[j].fromBufferAttribute(position, index?.getX(i + j) ?? i + j)
    }
    if (body.intersectsBox(triangleBounds.setFromPoints(vertices)) && body.intersectsTriangle(triangle))
      return true
  }
  return false
}

function capacityWitness(cells) {
  const conflicts = (a, b) => Math.max(Math.abs(a.i - b.i), Math.abs(a.j - b.j)) < 3
  const witness = []
  let remaining = cells
  while (remaining.length) {
    let fewestConflicts = Infinity
    let next
    for (const cell of remaining) {
      const count = remaining.filter(other => conflicts(cell, other)).length
      if (count < fewestConflicts) {
        fewestConflicts = count
        next = cell
      }
    }
    witness.push(next.cellId)
    remaining = remaining.filter(cell => !conflicts(cell, next))
  }
  return witness
}

/** Prepare the sector once from the actual respawn pose, floor, room triangles and hitbox profile. */
export function prepareRoomSpawnLayout({ collision, room, surfaces, geometry, scale, player }) {
  const candidates = sectorCells(collision.spawn)
  const floorByHeight = [...collision.floors].sort((a, b) => b.max[1] - a.max[1])
  const solids = [room, ...surfaces].flatMap(collectOpaqueMeshes)
  const carpets = solids.filter(({ mesh }) => mesh.name.includes('_Carpet'))
  const bounds = {
    min: geometry.bounds.min.map(value => value * scale),
    max: geometry.bounds.max.map(value => value * scale),
  }
  const aimPoints = geometry.aimPoints.map(point => point.map(value => value * scale))
  const feet = new Vector3().fromArray(collision.spawn.position)
  const playerVolume = characterBox(feet, player, false)
  const playerBounds = new Box3(new Vector3().fromArray(playerVolume.min), new Vector3().fromArray(playerVolume.max))
  const eye = feet.clone().add(new Vector3(0, player.standEye, 0))
  const raycaster = new Raycaster()
  const body = new Box3()
  const point = new Vector3()
  const triangle = new Triangle()
  const triangleBounds = new Box3()
  const eyePosition = eye.toArray()
  const rejected = {}
  const meshConflicts = {}
  const reject = (reason) => {
    rejected[reason] = (rejected[reason] ?? 0) + 1
    return null
  }
  const cells = validateSectorCells(candidates, (cell) => {
    const [x, z] = cell.center
    const floor = floorByHeight.find(box => onFootprint(box, x, z))
    if (!floor)
      return reject('floor')
    const floorY = floor.max[1]
    const footprintX = cell.corners.map(corner => corner[0])
    const footprintZ = cell.corners.map(corner => corner[1])
    if (!supported(floorByHeight, floorY, Math.min(x + bounds.min[0], ...footprintX), Math.max(x + bounds.max[0], ...footprintX), Math.min(z + bounds.min[2], ...footprintZ), Math.max(z + bounds.max[2], ...footprintZ))) {
      return reject('floor')
    }
    // The room carpets are visible walkable overlays on the collision floor.
    // Sample their actual top face so a robot stands on the carpet.
    const reach = player.stepHeight
    raycaster.set(point.set(x, floorY + reach, z), down)
    raycaster.far = reach
    let y = floorY
    for (const { mesh, bounds } of carpets) {
      if (raycaster.ray.intersectsBox(bounds)) {
        const hit = raycaster.intersectObject(mesh, false)[0]
        if (hit)
          y = Math.max(y, hit.point.y)
      }
    }
    // The broadphase includes a small downward hitbox margin. Ground contact is allowed.
    body.min.set(x + bounds.min[0], y + tolerance, z + bounds.min[2])
    body.max.set(x + bounds.max[0], y + bounds.max[1], z + bounds.max[2])
    if (collision.world.queryAABB({
      min: body.min.toArray(),
      max: body.max.toArray(),
    }).length) {
      return reject('collision')
    }
    if (body.intersectsBox(playerBounds))
      return reject('player')
    const blocker = solids.find(entry => body.intersectsBox(entry.bounds) && intersectsMesh(body, entry, triangle, triangleBounds))
    if (blocker) {
      const name = blocker.mesh.name
      meshConflicts[name] = (meshConflicts[name] ?? 0) + 1
      return reject('mesh')
    }
    for (const [offsetX, offsetY, offsetZ] of aimPoints) {
      point.set(x + offsetX, y + offsetY, z + offsetZ).sub(eye)
      const length = point.length()
      const direction = point.multiplyScalar(1 / length)
      const directionArray = direction.toArray()
      const limit = length - tolerance
      if (collision.world.boxes.some(box => intersectRayBox(eyePosition, directionArray, box, limit)))
        return reject('blocked-ray')
      raycaster.set(eye, direction)
      raycaster.far = limit
      if (solids.some(({ mesh, bounds }) => raycaster.ray.intersectsBox(bounds) && raycaster.intersectObject(mesh, false).length))
        return reject('blocked-view')
    }
    return y
  })
  // Witness cells' 3×3 neighborhoods are disjoint. Any occupied cell can block
  // at most one witness cell, so random draws cannot strand the last replacement.
  const witness = capacityWitness(cells)
  return {
    cells,
    diagnostics: immutableFact({
      candidateCells: candidates.length,
      legalCells: cells.length,
      rejected,
      meshConflicts,
      bounds,
      eye: eyePosition,
      aimPoints,
      guaranteedOwners: Math.max(witness.length, Math.ceil(cells.length / 9)),
      witness,
    }),
  }
}
