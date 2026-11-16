import * as THREE from 'three/webgpu'
import { createDecalSystem } from '../src/engine/runtime/function/decal/decal-system.js'

function check(condition, message) {
  if (!condition)
    throw new Error(message)
}

function darkBounds(pixels, width) {
  let minX = width
  let maxX = -1
  let count = 0
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index] >= 100)
      continue
    const x = (index / 4) % width
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    count++
  }
  return { minX, maxX, count }
}

/** Exercise actual GPU instancing, not just the matrices written on the CPU. */
export async function checkDecalPlacement() {
  const renderer = new THREE.WebGPURenderer({ antialias: false })
  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.05, 10)
  const width = 128
  const target = new THREE.RenderTarget(width, width, { type: THREE.UnsignedByteType })
  const geometry = new THREE.PlaneGeometry(2, 2)
  const material = new THREE.MeshBasicNodeMaterial({ color: 0xFFFFFF })
  const wall = new THREE.Mesh(geometry, material)
  const occluder = new THREE.Mesh(geometry, material)
  const decals = createDecalSystem({ scene, capacity: 2 })
  const surface = new THREE.Vector3(4, 10, -7)
  const forward = new THREE.Vector3(0, 0, 1)
  const samples = []
  scene.add(wall, occluder)
  occluder.scale.setScalar(0.2)
  const pixels = async () => {
    renderer.setRenderTarget(target)
    renderer.render(scene, camera)
    return renderer.readRenderTargetPixelsAsync(target, 0, 0, width, width)
  }
  try {
    await renderer.init()
    renderer.setSize(width, width)
    renderer.setClearColor(0xFFFFFF, 1)
    for (const [index, values] of [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ].entries()) {
      const normal = new THREE.Vector3(...values)
      camera.position.copy(surface).addScaledVector(normal, 2)
      camera.up.set(0, 1, 0)
      if (Math.abs(normal.y) > 0.9)
        camera.up.set(0, 0, 1)
      camera.lookAt(surface)
      camera.updateMatrixWorld(true)
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0)
      const position = surface.clone().addScaledVector(right, 0.5)
      const rotation = index < 3
        ? 0
        : Math.PI / 4
      wall.position.copy(surface)
      wall.quaternion.setFromUnitVectors(forward, normal)
      occluder.position.copy(position).addScaledVector(normal, 0.5)
      occluder.quaternion.copy(wall.quaternion)
      occluder.visible = false
      decals.clear()
      decals.emit([
        {
          position: position.toArray(),
          normal: values,
          size: 0.2,
          rotation,
          born: 10,
          color: 0x000000,
        },
      ])
      decals.flush({ presentationTime: 9 })
      check(darkBounds(await pixels(), width).count === 0, `Future decal appeared on normal ${values}`)
      decals.flush({ presentationTime: 10 })
      const bounds = darkBounds(await pixels(), width)
      const center = (bounds.minX + bounds.maxX) / 2
      const expectedWidth = 0.2 * (Math.abs(Math.cos(rotation)) + Math.abs(Math.sin(rotation))) * width / 2
      check(bounds.count > 0, `Non-origin decal is missing on normal ${values}`)
      check(Math.abs(center - 95.5) <= 1, `Instance translation lost on normal ${values}: ${JSON.stringify(bounds)}`)
      check(Math.abs(bounds.maxX - bounds.minX + 1 - expectedWidth) <= 2, `Instance size/rotation lost on normal ${values}`)
      check(darkBounds(await pixels(), width).count === bounds.count, 'Repeated rendering changed decal pixels')
      decals.flush({ presentationTime: 10000 })
      check(darkBounds(await pixels(), width).count === bounds.count, 'Persistent decal expired')
      occluder.visible = true
      check(darkBounds(await pixels(), width).count === 0, `World geometry did not occlude decal on normal ${values}`)
      occluder.visible = false
      decals.clear()
      check(darkBounds(await pixels(), width).count === 0, 'Reset left decal pixels')
      samples.push({
        normal: values,
        position: position.toArray(),
        rotation,
        center,
        width: bounds.maxX - bounds.minX + 1,
        pixels: bounds.count,
      })
    }
    // Birth is per instance: one live mark must not reveal a future mark.
    camera.position.set(4, 10, -5)
    camera.up.set(0, 1, 0)
    camera.lookAt(surface)
    wall.position.copy(surface)
    wall.quaternion.identity()
    decals.emit([-0.5, 0.5].map((x, index) => ({
      position: [surface.x + x, surface.y, surface.z],
      normal: [0, 0, 1],
      size: 0.2,
      born: index * 10,
      color: 0x000000,
    })))
    decals.flush({ presentationTime: 5 })
    const single = darkBounds(await pixels(), width)
    check(single.count > 0 && single.maxX < width / 2, 'Birth mask leaked between decal instances')
    decals.flush({ presentationTime: 10 })
    const both = darkBounds(await pixels(), width)
    check(both.count === single.count * 2 && both.maxX > width / 2, 'Second decal did not appear at its own birth time')
    return { samples, singlePixels: single.count, bothPixels: both.count }
  }
  finally {
    renderer.setRenderTarget(null)
    decals.dispose()
    geometry.dispose()
    material.dispose()
    target.dispose()
    renderer.dispose()
  }
}
