import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import * as THREE from 'three/webgpu'
import { atlasLayout, probeCaptureDefaults, probeSourceKey, sha256, validateCapture, validateProbeVolumes } from '../src/world/probe-data.js'
import { createRoomLights } from '../src/world/room-lights.js'

const read = file => JSON.parse(fs.readFileSync(new URL(file, import.meta.url)))
const definitions = read('../public/lighting/range-room-probes/volumes.json')
const room = read('../public/lighting/range-room-lightmap/manifest.json')

test('authored LPV bounds use world corners, including off-center origins and the authored corridor gap', () => {
  const volumes = validateProbeVolumes(definitions)
  assert.equal(volumes.length, 3)
  const hall = volumes.find(v => v.id === 'LPV_Room')
  assert.ok(Math.abs(hall.min[1] - 9.049585342407227) < 1e-6)
  assert.ok(Math.abs(hall.max[2] - 18.980003356933594) < 1e-6)
  const first = volumes.find(v => v.id === 'LPV_Corridor_01')
  const second = volumes.find(v => v.id === 'LPV_Corridor_02')
  assert.ok(Math.abs(first.min[2] - second.max[2] - 1.80029296875) < 1e-6)
  for (const mutate of [
    data => data.volumes.push(data.volumes[0]),
    data => data.volumes[0].resolution.splice(0, 1, 0),
    data => data.volumes[0].max.splice(1, 1, data.volumes[0].min[1]),
  ]) {
    const invalid = structuredClone(definitions)
    mutate(invalid)
    assert.throws(() => validateProbeVolumes(invalid), /Probes/)
  }
})

test('precomputed SH matches room assets and volume definitions, is finite, spatially varying and correctly padded', async () => {
  const cache = read('../public/lighting/range-room-probes/cache.json')
  const bytes = fs.readFileSync(new URL('../public/lighting/range-room-probes/probe-atlas.bin', import.meta.url))
  assert.equal(cache.sourceKey, probeSourceKey(room, definitions.volumes, '/hdr/skybox-day.png'))
  assert.equal(cache.sha256, await sha256(bytes))
  assert.deepEqual(cache.capture, probeCaptureDefaults)
  let length = 0
  for (const volume of definitions.volumes) {
    const entry = cache.volumes.find(v => v.id === volume.id)
    const layout = atlasLayout(volume.resolution)
    assert.equal(entry.offset, length)
    assert.equal(entry.bytes, layout.bytes)
    const values = Array.from({ length: entry.bytes / 2 }, (_, i) => bytes.readUInt16LE(entry.offset + i * 2))
    const decoded = values.map(THREE.DataUtils.fromHalfFloat)
    assert.ok(decoded.every(Number.isFinite))
    assert.ok(decoded.some(value => value > 0.01))
    assert.ok(new Set(values).size > 20)
    const row = layout.width * layout.height * 4
    const slices = volume.resolution[2] + 2
    for (let channel = 0; channel < 7; channel++) {
      const start = channel * slices * row
      assert.deepEqual(values.slice(start, start + row), values.slice(start + row, start + 2 * row))
      const end = start + slices * row
      assert.deepEqual(values.slice(end - row, end), values.slice(end - 2 * row, end - row))
    }
    length += layout.bytes
  }
  assert.equal(bytes.length, length)
  const changed = structuredClone(definitions.volumes)
  changed[0].min[0] += 0.1
  assert.notEqual(cache.sourceKey, probeSourceKey(room, changed, '/hdr/skybox-day.png'))
})

test('capture parameters are bounded and top-light scaling survives global lighting toggles', () => {
  validateCapture(probeCaptureDefaults)
  assert.throws(() => validateCapture({ ...probeCaptureDefaults, cubemapSize: 13 }), /resolution/)
  assert.throws(() => validateCapture({ ...probeCaptureDefaults, emissive: Number.NaN }), /emissive/)
  const lights = createRoomLights(room, { environmentLoaded: true })
  try {
    const original = lights.root.children[0].intensity
    lights.setIntensityScale(0.4)
    assert.equal(lights.root.children[0].intensity, original * 0.4)
    lights.setEnabled(false)
    assert.equal(lights.root.children[0].intensity, 0)
    lights.setEnabled(true)
    assert.equal(lights.root.children[0].intensity, original * 0.4)
    assert.throws(() => lights.setIntensityScale(-1), /Invalid/)
  }
  finally {
    lights.dispose()
  }
})
