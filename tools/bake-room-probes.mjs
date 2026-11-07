import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { openBrowser } from './browser-session.mjs'

const output = process.env.ROOM_TEST_OUTPUT ?? 'D:/opencode-temp/opencode/light-probes/bake'
const destination = path.resolve(process.env.PROBE_OUTPUT ?? 'public/lighting/range-room-probes')
const session = await openBrowser({ output })
try {
  await session.navigate(process.argv[2] ?? 'http://127.0.0.1:5173/')
  await session.evaluate(`new Promise((resolve,reject)=>{
    const deadline=performance.now()+115000;
    function check(){
      const error=document.querySelector('.unsupported');
      if(error&&!error.hidden)return reject(new Error(error.textContent));
      if(globalThis.__RANGE_ROOM__?.ready)return resolve(true);
      if(performance.now()>deadline)return reject(new Error('Probe startup timeout'));
      requestAnimationFrame(check);
    }check();
  })`)
  const data = await session.evaluate(`(async()=>{
    const app=__RANGE_ROOM__;app.inspection.setPaused(true);
    if(!app.world.probes)throw new Error('LightProbe is not enabled');
    if(app.world.probes.getDebugState().source!=='live-capture')await app.world.probes.rebake();
    return app.world.probes.exportData();
  })()`)
  if (session.errors.length)
    throw new Error(session.errors.join('\n'))
  const buffers = []
  let offset = 0
  const volumes = data.volumes.map((volume) => {
    const bytes = Buffer.alloc(volume.data.length * 2)
    volume.data.forEach((value, i) => bytes.writeUInt16LE(value, i * 2))
    buffers.push(bytes)
    const entry = { id: volume.id, offset, bytes: bytes.length }
    offset += bytes.length
    return entry
  })
  const bytes = Buffer.concat(buffers)
  const manifest = {
    version: data.version,
    sourceKey: data.sourceKey,
    capture: data.capture,
    encoding: 'rgba16f-le',
    url: './probe-atlas.bin',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    volumes,
  }
  fs.mkdirSync(destination, { recursive: true })
  fs.writeFileSync(path.join(destination, 'probe-atlas.bin'), bytes)
  fs.writeFileSync(path.join(destination, 'cache.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  const report = {
    bytes: bytes.length,
    probes: await session.evaluate('__RANGE_ROOM__.world.probes.getDebugState()'),
    errors: session.errors,
    messages: session.messages,
  }
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
}
catch (error) {
  fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ error: error.stack, errors: session.errors, messages: session.messages }, null, 2))
  throw error
}
finally {
  session.close()
}
