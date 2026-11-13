/** Isolate each real skinned arm and read the viewmodel HDR alpha, not CPU visibility flags. */
export async function measureArmCoverage(app) {
  const { render } = app
  const scene = render.viewmodel.scene
  const meshes = []
  scene.traverse((object) => {
    if (object.isMesh)
      meshes.push({ object, visible: object.visible })
  })
  const width = render.renderer.domElement.width
  const height = render.renderer.domElement.height
  const points = []
  for (let y = 0.05; y < 1; y += 0.07) {
    for (let x = 0.05; x < 1; x += 0.07) {
      points.push([
        Math.floor(x * width),
        Math.floor(y * height),
      ])
    }
  }
  const result = {}
  try {
    for (const side of ['Left', 'Right']) {
      const arm = scene.getObjectByName(`Arms_${side}`)
      if (!arm?.isSkinnedMesh || !arm.material.map)
        throw new Error(`Missing skinned arm or atlas: ${side}`)
      for (const { object, visible } of meshes)
        object.visible = visible && object === arm
      await new Promise(requestAnimationFrame)
      render.update()
      const pixels = await Promise.all(points.map(([x, y]) => render.readViewModelPixel(x, y)))
      result[side] = {
        covered: pixels.filter(pixel => pixel[3] > 0.9).length,
        frustumCulled: arm.frustumCulled,
        map: arm.material.map.uuid,
      }
    }
    return result
  }
  finally {
    for (const { object, visible } of meshes) object.visible = visible
    await new Promise(requestAnimationFrame)
    render.update()
  }
}
