import * as THREE from 'three/webgpu'

/** Keep the 4K background; a 1K lighting proxy bounds automatic PMREM to 256px faces. */
export function createEnvironmentProxy(sky, canvas = document.createElement('canvas')) {
  canvas.width = Math.min(1024, sky.image.width)
  canvas.height = Math.max(1, Math.round(sky.image.height * canvas.width / sky.image.width))
  const context = canvas.getContext('2d')
  if (!context)
    throw new Error('Unable to create sky environment proxy')
  context.drawImage(sky.image, 0, 0, canvas.width, canvas.height)
  const texture = new THREE.CanvasTexture(canvas)
  texture.name = 'skybox-day:lighting-proxy'
  texture.colorSpace = THREE.SRGBColorSpace
  texture.mapping = THREE.EquirectangularReflectionMapping
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  return texture
}
