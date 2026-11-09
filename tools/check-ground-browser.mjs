import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { openBrowser } from './browser-session.mjs'

const output = path.resolve(process.env.ROOM_TEST_OUTPUT ?? 'D:/opencode-temp/opencode/superflat-ground-browser')
const report = { url: process.argv[2] ?? process.env.ROOM_TEST_URL ?? 'http://127.0.0.1:5173/', errors: [], messages: [] }
const target = new URL(report.url)
target.searchParams.set('player', '0')
report.url = target.href
const session = await openBrowser({ output, errors: report.errors, messages: report.messages })
try {
  const { evaluate, send, frames } = session
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await session.navigate(report.url)
  await evaluate(`new Promise((resolve,reject)=>{
    const deadline=performance.now()+100000;
    function check(){
      const error=document.querySelector('.unsupported');
      if(error&&!error.hidden)return reject(new Error(error.textContent));
      if(globalThis.__RANGE_ROOM__?.ready)return resolve(true);
      if(performance.now()>deadline)return reject(new Error('Room load timeout'));
      requestAnimationFrame(check);
    }check();
  })`)
  await evaluate(`__RANGE_ROOM__.inspection.setPaused(true);document.querySelector('.debug-panel').hidden=true;document.querySelector('.room-inspection').hidden=true`)
  await frames(16)
  report.initial = await evaluate('__RANGE_ROOM__.snapshot()')
  const { ground, bounds, probes } = report.initial
  assert.deepEqual(ground.roomBounds, bounds)
  assert.equal(ground.meshes, 2)
  assert.equal(ground.triangles, 10)
  assert.equal(ground.tileSize, 1)
  assert.ok(Math.abs(ground.height - (bounds.min[1] - 0.01)) < 1e-6)
  if (probes) {
    assert.equal(probes.source, 'precomputed')
    assert.equal(probes.lastBakeMs, null)
  }
  const screenshot = async (name) => {
    const image = await send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(output, name), Buffer.from(image.data, 'base64'))
  }
  const pose = async (position, target) => {
    await evaluate(`(()=>{
      const a=__RANGE_ROOM__;a.inspection.fly.cancel();a.camera.position.fromArray(${JSON.stringify(position)});
      a.controls.target.fromArray(${JSON.stringify(target)});a.controls.update();a.camera.updateMatrixWorld();
    })()`)
    await frames(16)
  }
  await screenshot('interior.png')
  const cx = (bounds.min[0] + bounds.max[0]) / 2
  const cz = (bounds.min[2] + bounds.max[2]) / 2
  await pose([cx + 66, ground.height + 42, cz - 70], [cx, ground.height + 8, cz])
  await screenshot('exterior-overview.png')
  await pose([cx + 38, ground.height + 1.7, bounds.min[2] - 29], [cx, ground.height + 7, cz])
  await screenshot('exterior-eye-level.png')
  await pose([bounds.min[0] - 1.4, ground.height + 2.2, bounds.min[2] + 1.6], [bounds.min[0] + 1.2, ground.height, bounds.min[2] + 3])
  await screenshot('quartz-grass-boundary.png')
  await evaluate('__RANGE_ROOM__.room.root.visible=false;__RANGE_ROOM__.inspection.teapot.mesh.visible=false')
  await pose([cx, ground.height + 65, cz + 0.01], [cx, ground.height, cz])
  await screenshot('footprint-only.png')
  report.gpuTextures = await evaluate(`__RANGE_ROOM__.world.ground.root.children.map(mesh=>{
    const map=mesh.material.map,data=__RANGE_ROOM__.render.renderer.backend.get(map);
    return {name:mesh.name,width:data.texture.width,height:data.texture.height,mipLevels:data.texture.mipLevelCount,wrapS:map.wrapS,wrapT:map.wrapT,anisotropy:map.anisotropy,color:mesh.material.color.getHexString()};
  })`)
  for (const texture of report.gpuTextures) {
    assert.equal(texture.width, 16)
    assert.equal(texture.height, 16)
    assert.equal(texture.mipLevels, 5)
    assert.equal(texture.wrapS, 1000)
    assert.equal(texture.wrapT, 1000)
    assert.ok(texture.anisotropy > 1)
  }
  assert.equal(report.gpuTextures.find(texture => texture.name === 'Ground_Grass').color, '91bd59')
  report.regions = await evaluate(`(()=>{
    const a=__RANGE_ROOM__,s=a.world.ground.snapshot(), b=s.footprint, samples=[];
    for(let y=100;y<1000;y+=80)for(let x=100;x<1820;x+=100){
      const hit=a.pickPixel(x,y);if(hit?.name?.startsWith('Ground_'))samples.push({x,y,name:hit.name});
    }
    return {quartz:samples.filter(s=>s.name==='Ground_Quartz').length,grass:samples.filter(s=>s.name==='Ground_Grass').length,samples};
  })()`)
  assert.ok(report.regions.quartz > 0 && report.regions.grass > 0)
  // Indoor lighting controls must not darken outdoor grass or inject probe GI into the foundation.
  if (probes) {
    const samples = report.regions.samples.filter((_, i) => i % 12 === 0)
    await evaluate(`globalThis.__GROUND_PIXELS__=${JSON.stringify(samples)}`)
    const read = () => evaluate('Promise.all(__GROUND_PIXELS__.map(p=>__RANGE_ROOM__.render.readLinearPixel(p.x,p.y)))')
    const before = await read()
    await evaluate('__RANGE_ROOM__.world.probes.setLighting({enabled:false,skyDiffuse:0,skySpecular:0,direct:0})')
    await frames(8)
    const after = await read()
    report.indoorLightingDelta = Math.max(...before.flatMap((pixel, i) => pixel.slice(0, 3).map((value, c) => Math.abs(value - after[i][c]))))
    assert.ok(report.indoorLightingDelta < 0.0001)
    await evaluate('__RANGE_ROOM__.world.probes.reset();delete globalThis.__GROUND_PIXELS__')
  }
  await evaluate('__RANGE_ROOM__.room.root.visible=true;__RANGE_ROOM__.inspection.teapot.mesh.visible=true')
  assert.deepEqual(report.errors, [])
  report.passed = true
}
catch (error) {
  report.passed = false
  report.failure = error.stack
  process.exitCode = 1
}
finally {
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({
    passed: report.passed,
    failure: report.failure,
    errors: report.errors,
    ground: report.initial?.ground,
    gpuTextures: report.gpuTextures,
    indoorLightingDelta: report.indoorLightingDelta,
  }, null, 2))
  session.close()
}
