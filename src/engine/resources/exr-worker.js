import { parseEXRData } from './exr-data.js'

globalThis.onmessage = ({ data: { buffer, maxMipLevel } }) => {
  try {
    const parsed = parseEXRData(buffer, maxMipLevel)
    globalThis.postMessage({ parsed }, parsed.mipmaps.map(mip => mip.data.buffer))
  }
  catch (error) {
    globalThis.postMessage({ error: error.message })
  }
}
