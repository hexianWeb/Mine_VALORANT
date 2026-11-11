import { HalfFloatType } from 'three'
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js'
import { buildAtlasMips } from './atlas-mips.js'

/** 只传递可转移的像素数据；GPU 纹理由持有渲染器的线程创建。 */
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
