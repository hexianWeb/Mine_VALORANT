import { HalfFloatType } from 'three'
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js'
import { buildAtlasMips } from './atlas-mips.js'

/** Transferable pixel data only; GPU textures are created by the owning renderer thread. */
export function parseEXRData(buffer, maxMipLevel = 0) {
  const started = performance.now()
  const parsed = new EXRLoader().setDataType(HalfFloatType).parse(buffer)
  const { data, width, height, format, type, colorSpace } = parsed
  const mipmaps = buildAtlasMips({ data, width, height }, maxMipLevel)
  return {
    data,
    width,
    height,
    format,
    type,
    colorSpace,
    mipmaps,
    decodeMs: performance.now() - started,
  }
}
