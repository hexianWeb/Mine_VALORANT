import { mix, texture, uv } from 'three/tsl'
import * as THREE from 'three/webgpu'

// r187 WebGPU CubeCamera's first two layers look toward -X and +X respectively.
const faces = [1, 2, 4, 0, 3, 5]
const labels = ['+X', '+Y', '+Z', '-X', '-Y', '-Z']

function makeLegend(size) {
  if (typeof document === 'undefined')
    return null
  const canvas = document.createElement('canvas')
  canvas.width = size * 3
  canvas.height = size * 2
  const context = canvas.getContext('2d')
  if (!context)
    throw new Error('[Reflection preview] Canvas 2D unavailable')
  context.font = 'bold 16px monospace'
  context.textBaseline = 'top'
  for (let i = 0; i < faces.length; i++) {
    const x = (i % 3) * size
    const y = Math.floor(i / 3) * size
    context.fillStyle = 'rgba(0, 0, 0, 0.8)'
    context.fillRect(x, y, size, 28)
    context.fillStyle = '#ffffff'
    context.fillText(`${labels[i]} | RAW FACE ${faces[i]}`, x + 8, y + 6)
    context.strokeStyle = '#ffffff'
    context.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1)
  }
  const legend = new THREE.CanvasTexture(canvas)
  legend.colorSpace = THREE.SRGBColorSpace
  legend.flipY = false
  legend.generateMipmaps = false
  legend.minFilter = THREE.LinearFilter
  return legend
}

/** Copy saved half-float pixels into one 3x2 contact sheet; never sample PMREM or recapture. */
export function createReflectionPreview(cube) {
  const size = cube.images[0]?.image.width
  if (!Number.isInteger(size) || size < 1 || cube.images.length !== 6)
    throw new Error('[Reflection preview] Invalid cube faces')
  const width = size * 3
  const height = size * 2
  const pixels = new Uint16Array(width * height * 4)
  for (const [tile, face] of faces.entries()) {
    const source = cube.images[face].image
    if (source.width !== size || source.height !== size
      || !(source.data instanceof Uint16Array) || source.data.length !== size * size * 4) {
      throw new Error('[Reflection preview] Invalid half-float face')
    }
    for (let y = 0; y < size; y++) {
      const destination = ((Math.floor(tile / 3) * size + y) * width + (tile % 3) * size) * 4
      pixels.set(source.data.subarray(y * size * 4, (y + 1) * size * 4), destination)
    }
  }
  const atlas = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat, THREE.HalfFloatType)
  atlas.name = 'Saved room HDR cube: raw 3x2 preview'
  atlas.colorSpace = THREE.LinearSRGBColorSpace
  atlas.flipY = false
  atlas.generateMipmaps = false
  atlas.minFilter = atlas.magFilter = THREE.NearestFilter
  atlas.needsUpdate = true
  const legend = makeLegend(size)
  const material = new THREE.MeshBasicNodeMaterial()
  material.name = 'Raw HDR reflection preview (no lighting / no PMREM)'
  // Raw WebGPU rows start at the top. PlaneGeometry's top vertices have V=1.
  const previewUV = uv().flipY()
  const image = texture(atlas, previewUV).rgb
  if (legend) {
    const overlay = texture(legend, previewUV)
    material.colorNode = mix(image, overlay.rgb, overlay.a)
  }
  else {
    material.colorNode = image
  }
  const geometry = new THREE.PlaneGeometry(7.8, 5.2)
  const root = new THREE.Mesh(geometry, material)
  root.name = 'Hall center: saved HDR Cubemap preview'
  root.position.set(0.5, 11.8, 5.5)
  root.rotation.y = Math.PI // Face the spawn/corridor entrance, not the rear wall.
  root.userData.reflectionPreview = true
  root.raycast = () => {}
  let disposed = false
  return {
    root,
    texture: atlas,
    getDebugState: () => ({
      ready: !disposed,
      visible: root.visible && !disposed,
      source: 'saved-hdr-cubemap',
      size: [width, height],
      faceSize: size,
      layout: [
        labels.slice(0, 3),
        labels.slice(3),
      ],
      sourceFaces: [...faces],
      position: root.position.toArray(),
      gain: 1,
      pmrem: false,
      captures: 0,
    }),
    dispose() {
      if (disposed)
        return
      disposed = true
      root.removeFromParent()
      geometry.dispose()
      material.dispose()
      atlas.dispose()
      legend?.dispose()
    },
  }
}
