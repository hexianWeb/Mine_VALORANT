/** 释放自有资源树，不要用于共享 ResourceManager 模板的克隆体。 */
export function disposeObject3D(root) {
  const resources = new Set()
  root.traverse((object) => {
    if (object.geometry)
      resources.add(object.geometry)
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material]
    for (const material of materials) {
      if (!material)
        continue
      for (const value of Object.values(material)) {
        if (value?.isTexture)
          resources.add(value)
      }
      resources.add(material)
    }
  })
  for (const resource of resources) resource.dispose()
}
