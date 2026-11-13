import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { deflateSync, inflateSync } from 'node:zlib'

const signature = Buffer.from('89504e470d0a1a0a', 'hex')
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit++) {
    value = value & 1
      ? 0xEDB88320 ^ (value >>> 1)
      : value >>> 1
  }
  return value >>> 0
})
const hash = bytes => createHash('sha256').update(bytes).digest('hex')

function crc32(bytes) {
  let value = 0xFFFFFFFF
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8)
  return (value ^ 0xFFFFFFFF) >>> 0
}

function paeth(a, b, c) {
  const value = a + b - c
  const distances = [
    Math.abs(value - a),
    Math.abs(value - b),
    Math.abs(value - c),
  ]
  if (distances[0] <= distances[1] && distances[0] <= distances[2])
    return a
  return distances[1] <= distances[2]
    ? b
    : c
}

/** Narrow, lossless PNG codec: noninterlaced 8-bit RGB/RGBA; reject other encodings. */
export function decodeAtlas(bytes) {
  assert.ok(bytes.subarray(0, 8).equals(signature), 'Expected PNG')
  const compressed = []
  const metadata = []
  let width
  let height
  let channels
  let ended = false
  for (let offset = 8; offset < bytes.length;) {
    assert.ok(offset + 12 <= bytes.length, 'Truncated PNG chunk')
    const length = bytes.readUInt32BE(offset)
    assert.ok(offset + length + 12 <= bytes.length, 'PNG chunk exceeds file')
    const type = bytes.toString('ascii', offset + 4, offset + 8)
    const data = bytes.subarray(offset + 8, offset + 8 + length)
    assert.equal(crc32(bytes.subarray(offset + 4, offset + 8 + length)), bytes.readUInt32BE(offset + 8 + length), `PNG CRC mismatch: ${type}`)
    if (type === 'IHDR') {
      assert.equal(offset, 8)
      assert.equal(length, 13)
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      assert.ok(width > 0 && height > 0 && width <= 8192 && height <= 8192)
      assert.ok(data[8] === 8 && [2, 6].includes(data[9]) && data[10] === 0 && data[11] === 0 && data[12] === 0, 'Unsupported PNG encoding')
      channels = data[9] === 6
        ? 4
        : 3
    }
    else if (type === 'IDAT') {
      compressed.push(data)
    }
    else if (['sRGB', 'gAMA', 'cHRM', 'iCCP'].includes(type)) {
      metadata.push({
        type,
        data: Buffer.from(data),
      })
    }
    else if (type === 'IEND') {
      assert.equal(length, 0)
      assert.equal(offset + 12, bytes.length)
      ended = true
    }
    else {
      assert.ok(!['acTL', 'tRNS'].includes(type), 'Animated PNG or implicit transparency is unsupported')
      assert.ok(type[0] === type[0].toLowerCase() || type === 'PLTE', `Unknown critical PNG chunk: ${type}`)
    }
    offset += length + 12
  }
  assert.ok(ended && channels && compressed.length, 'Incomplete PNG')
  const stride = width * channels
  const raw = inflateSync(Buffer.concat(compressed), { maxOutputLength: height * (stride + 1) })
  assert.equal(raw.length, height * (stride + 1))
  const unpacked = Buffer.alloc(width * height * channels)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    assert.ok(filter <= 4, 'Unknown PNG filter')
    for (let x = 0; x < stride; x++) {
      const left = x >= channels
        ? unpacked[y * stride + x - channels]
        : 0
      const up = y
        ? unpacked[(y - 1) * stride + x]
        : 0
      const upperLeft = y && x >= channels
        ? unpacked[(y - 1) * stride + x - channels]
        : 0
      const predictor = [
        0,
        left,
        up,
        Math.floor((left + up) / 2),
        paeth(left, up, upperLeft),
      ][filter]
      unpacked[y * stride + x] = (raw[y * (stride + 1) + x + 1] + predictor) & 255
    }
  }
  const rgba = Buffer.alloc(width * height * 4)
  for (let pixel = 0; pixel < width * height; pixel++) {
    unpacked.copy(rgba, pixel * 4, pixel * channels, pixel * channels + 3)
    rgba[pixel * 4 + 3] = channels === 4
      ? unpacked[pixel * 4 + 3]
      : 255
  }
  return { width, height, rgba, metadata }
}

function chunk(type, data) {
  const header = Buffer.alloc(8)
  header.writeUInt32BE(data.length)
  header.write(type, 4, 4, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([
    header.subarray(4),
    data,
  ])))
  return Buffer.concat([header, data, crc])
}

export function encodeAtlas({ width, height, rgba, metadata = [] }) {
  assert.equal(rgba.length, width * height * 4)
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  const rows = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) rgba.copy(rows, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  return Buffer.concat([
    signature,
    chunk('IHDR', header),
    ...metadata.map(({ type, data }) => chunk(type, data)),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** Keep original texels, a one-pixel sampler gutter, and a fully transparent outer edge. */
export function cropGunAtlas(bytes, { rect = [0, 0, 332, 332], padding = 2 } = {}) {
  const source = decodeAtlas(bytes)
  assert.ok(rect.length === 4 && rect.every(Number.isInteger) && Number.isInteger(padding) && padding >= 2)
  const [left, top, cropWidth, cropHeight] = rect
  assert.ok(left >= 0 && top >= 0 && cropWidth > 0 && cropHeight > 0 && left + cropWidth <= source.width && top + cropHeight <= source.height, 'Crop rectangle exceeds image')
  const width = cropWidth + padding * 2
  const height = cropHeight + padding * 2
  const rgba = Buffer.alloc(width * height * 4)
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const sx = Math.max(0, Math.min(source.width - 1, left + x - padding))
      const sy = Math.max(0, Math.min(source.height - 1, top + y - padding))
      source.rgba.copy(rgba, (y * width + x) * 4, (sy * source.width + sx) * 4, (sy * source.width + sx) * 4 + 4)
    }
  }
  const result = {
    width,
    height,
    rgba,
    metadata: source.metadata,
  }
  return {
    ...result,
    bytes: encodeAtlas(result),
    sourceSize: [source.width, source.height],
    rect,
    padding,
  }
}

function nextFloat(value, positive) {
  const array = new Float32Array([value])
  const bits = new Uint32Array(array.buffer)
  assert.ok(array[0] > 0 && array[0] < 1, 'UV requires a positive padding margin')
  bits[0] += positive
    ? 1
    : -1
  return array[0]
}

/** Blender UV convention: origin at the bottom left; crop rectangle uses PNG top-left. */
export function remapGunUV([u, v], { sourceSize, rect = [0, 0, 332, 332], padding = 2 }) {
  assert.ok([u, v, ...sourceSize].every(Number.isFinite))
  const x = u * sourceSize[0] - rect[0]
  const y = (1 - v) * sourceSize[1] - rect[1]
  assert.ok(x >= -1e-5 && y >= -1e-5 && x <= rect[2] + 1e-5 && y <= rect[3] + 1e-5, 'UV references excluded content; audit effect faces separately')
  return [
    nextFloat((x + padding) / (rect[2] + padding * 2), true),
    nextFloat(1 - (y + padding) / (rect[3] + padding * 2), false),
  ]
}

async function main(args) {
  const options = {}
  for (let i = 0; i < args.length; i += 2) {
    assert.ok([
      '--input',
      '--output',
      '--rect',
      '--padding',
    ].includes(args[i]) && args[i + 1], 'Pass --input PNG --output NEW_PNG [--rect x,y,w,h --padding 2]')
    options[args[i].slice(2)] = args[i + 1]
  }
  assert.ok(options.input && options.output)
  const result = cropGunAtlas(await readFile(options.input), {
    rect: options.rect?.split(',').map(Number),
    padding: options.padding === undefined
      ? 2
      : Number(options.padding),
  })
  await mkdir(path.dirname(path.resolve(options.output)), { recursive: true })
  try {
    assert.equal(hash(await readFile(options.output)), hash(result.bytes), 'Refusing to overwrite a changed texture')
  }
  catch (error) {
    if (error.code !== 'ENOENT')
      throw error
    await writeFile(options.output, result.bytes, { flag: 'wx' })
  }
  console.log(JSON.stringify({
    file: options.output,
    sourceSize: result.sourceSize,
    size: [result.width, result.height],
    padding: result.padding,
    sha256: hash(result.bytes),
  }, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
