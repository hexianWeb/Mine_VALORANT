import * as THREE from 'three/webgpu'

// Corner index bits: 1 = max x, 2 = max y, 4 = max z.
const EDGES = [
  [0, 1],
  [1, 3],
  [3, 2],
  [2, 0],
  [4, 5],
  [5, 7],
  [7, 6],
  [6, 4],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
]

/** Wireframe of collision boxes for debugging; hidden by default. The runtime ground box is skipped. */
export function createCollisionDebug(boxes, { color = 0x39FF88 } = {}) {
  const shown = boxes.filter(box => box.group !== 'Ground')
  const positions = new Float32Array(shown.length * EDGES.length * 6)
  let offset = 0
  for (const { min, max } of shown) {
    const corner = index => [
      index & 1
        ? max[0]
        : min[0],
      index & 2
        ? max[1]
        : min[1],
      index & 4
        ? max[2]
        : min[2],
    ]
    for (const [a, b] of EDGES) {
      positions.set(corner(a), offset)
      positions.set(corner(b), offset + 3)
      offset += 6
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const material = new THREE.LineBasicNodeMaterial({ color })
  const lines = new THREE.LineSegments(geometry, material)
  lines.name = 'CollisionDebug'
  lines.visible = false
  lines.userData.role = 'collision-debug'
  // Raycasters ignore `visible`; debug lines must never win scene picking.
  lines.raycast = () => {}
  return {
    root: lines,
    get visible() {
      return lines.visible
    },
    setVisible(value) {
      lines.visible = !!value
    },
    snapshot() {
      return { visible: lines.visible, boxes: shown.length, segments: shown.length * EDGES.length }
    },
    dispose() {
      lines.removeFromParent()
      geometry.dispose()
      material.dispose()
    },
  }
}
