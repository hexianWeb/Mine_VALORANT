import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { openBrowser } from './browser-session.mjs'

const output = process.env.REFLECTION_BAKE_OUTPUT ?? 'D:/opencode-temp/opencode/weapon-material-study/bake'
const destination = path.resolve(process.env.REFLECTION_OUTPUT ?? 'public/lighting/range-room-reflections/v1')
const url = new URL(process.argv[2] ?? 'http://127.0.0.1:5173/')
url.searchParams.delete('weaponStudy')
url.searchParams.set('editor', '0')
const session = await openBrowser({ output })
try {
  await session.navigate(url.href)
  await session.evaluate(`new Promise((resolve,reject)=>{const end=performance.now()+110000;function tick(){if(globalThis.__RANGE_ROOM__?.ready)return resolve(true);if(performance.now()>end)return reject(new Error('Reflection bake startup timeout'));requestAnimationFrame(tick)}tick()})`)
  const modulePath = `/@fs/${path.resolve('src/game/range-room/lighting/reflection-capture.js').replaceAll('\\', '/')}`
  const captured = await session.evaluate(`(async()=>{const app=__RANGE_ROOM__;app.engine.pause();const {captureRoomReflection}=await import(${JSON.stringify(modulePath)});return captureRoomReflection({renderer:app.render.renderer,room:app.room,scene:app.scene,skyboxUrl:app.world.settings.skyboxUrl})})()`)
  if (session.errors.length)
    throw new Error(session.errors.join('\n'))
  const bytes = Buffer.from(captured.base64, 'base64')
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const manifest = {
    version: captured.version,
    id: captured.id,
    encoding: captured.encoding,
    source: captured.source,
    url: `./room-${sha256}.bin`,
    sha256,
    bytes: bytes.length,
    stats: captured.stats,
  }
  const json = `${JSON.stringify(manifest, null, 2)}\n`
  const entry = path.join(destination, 'manifest.json')
  if (fs.existsSync(entry) && fs.readFileSync(entry, 'utf8') !== json)
    throw new Error('Refusing to overwrite published reflection; use REFLECTION_OUTPUT for a new version/candidate')
  fs.mkdirSync(destination, { recursive: true })
  fs.writeFileSync(path.join(destination, `room-${sha256}.bin`), bytes)
  fs.writeFileSync(entry, json)
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ manifest, errors: session.errors, messages: session.messages }, null, 2))
  console.log(JSON.stringify({
    destination,
    bytes: bytes.length,
    stats: captured.stats,
    errors: session.errors,
  }, null, 2))
}
finally {
  session.close()
}
