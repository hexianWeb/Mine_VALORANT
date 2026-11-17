import { ClampToEdgeWrapping, NearestFilter, NearestMipmapNearestFilter, SRGBColorSpace } from 'three/webgpu'

export const trainingBotSkins = Object.freeze({
  blue: Object.freeze({
    difficulty: 'easy',
    label: '简单',
    outlineColor: 0x4F9ED9,
    url: '/targets/skin/Range_Bot_Blue_128x128.png',
  }),
  yellow: Object.freeze({
    difficulty: 'medium',
    label: '中等',
    outlineColor: 0xD6B64A,
    url: '/targets/skin/Range_Bot_Yellow_128x128.png',
  }),
  purple: Object.freeze({
    difficulty: 'hard',
    label: '困难',
    outlineColor: 0x7A56A0,
    url: '/targets/skin/Range_Bot_urple_128x128.png',
  }),
})

/** Level-owned textures/material variants. Neither the GLB nor its template is modified. */
export async function loadTrainingBotSkins({ resources, signal }) {
  const entries = Object.entries(trainingBotSkins).map(([skin, { url }]) => ({
    name: `range-room:training-bot:skin:${skin}`,
    type: 'texture',
    url,
  }))
  const textures = new Map()
  const materials = new Map()
  const dispose = () => {
    for (const variants of materials.values()) {
      for (const material of variants.values()) material.dispose()
    }
    materials.clear()
    textures.clear()
    for (const { name } of entries) resources.unload(name)
  }
  try {
    await resources.load(entries, { signal })
    for (const [index, skin] of Object.keys(trainingBotSkins).entries()) {
      const entry = entries[index]
      const texture = resources.get(entry.name, entry.type)
      if (texture.image.width !== 128 || texture.image.height !== 128)
        throw new Error(`[Training bot] Expected a 128×128 skin atlas: ${skin}`)
      Object.assign(texture, {
        name: `Training bot:${skin}`,
        colorSpace: SRGBColorSpace,
        flipY: false,
        wrapS: ClampToEdgeWrapping,
        wrapT: ClampToEdgeWrapping,
        magFilter: NearestFilter,
        minFilter: NearestMipmapNearestFilter,
        generateMipmaps: true,
      })
      texture.needsUpdate = true
      textures.set(skin, texture)
      materials.set(skin, new Map())
    }
    return {
      apply(mesh, skin, source) {
        const variants = materials.get(skin)
        if (!variants)
          throw new Error(`[Training bot] Unknown skin: ${skin}`)
        const materialFor = (source) => {
          if (!variants.has(source)) {
            const material = source.clone()
            material.name = `${source.name}:${skin}`
            material.map = textures.get(skin)
            material.needsUpdate = true
            variants.set(source, material)
          }
          return variants.get(source)
        }
        mesh.material = Array.isArray(source)
          ? source.map(materialFor)
          : materialFor(source)
      },
      dispose,
    }
  }
  catch (error) {
    dispose()
    throw error
  }
}
