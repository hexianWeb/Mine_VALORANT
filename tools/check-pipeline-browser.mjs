import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { openBrowser } from './browser-session.mjs'

const output = path.resolve(process.env.ROOM_TEST_OUTPUT ?? 'D:/opencode-temp/opencode/render-v2/pipeline-browser')
const url = new URL(process.argv[2] ?? 'http://127.0.0.1:5173/')
url.searchParams.set('profile', '1')
const report = { url: url.href, errors: [], messages: [] }
let session
try {
  session = await openBrowser({ output, errors: report.errors, messages: report.messages })
  const { send, evaluate, frames, navigate } = session
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await navigate(url.href)
  await evaluate(`new Promise((resolve, reject) => {
    const deadline = performance.now()+100000;
    function check(){
      const error=document.querySelector('.unsupported');
      if(error&&!error.hidden)return reject(new Error(error.textContent));
      if(globalThis.__RANGE_ROOM__?.ready)return resolve(true);
      if(performance.now()>deadline)return reject(new Error('Room readiness timeout'));
      requestAnimationFrame(check);
    }
    check();
  })`)
  await frames(35)
  report.baseline = await evaluate('__RANGE_ROOM__.snapshot()')
  await evaluate('__RANGE_ROOM__.engine.pause()')
  // Vite dev serves this checked-in GPU fixture; production rendering is checked separately.
  const modulePath = `/@fs/${path.resolve('tests/pipeline-browser-cases.js').replaceAll('\\', '/')}`
  await evaluate(`import(${JSON.stringify(modulePath)}).then(module=>{globalThis.__PIPELINE_CASES__=module;return true})`)
  report.standalone = await evaluate('__PIPELINE_CASES__.checkStandaloneRenderSystem()')
  report.normals = await evaluate('__PIPELINE_CASES__.checkNormalPrepass()')
  const lightmapModule = `/@fs/${path.resolve('tests/lightmap-browser-cases.js').replaceAll('\\', '/')}`
  report.lightmapMaterial = await evaluate(`import(${JSON.stringify(lightmapModule)}).then(module=>module.checkLightmapMaterial())`)
  report.pixelArtMinification = await evaluate(`import(${JSON.stringify(lightmapModule)}).then(module=>module.checkPixelArtMinification())`)
  const probeModule = `/@fs/${path.resolve('tests/probe-lighting-browser-cases.js').replaceAll('\\', '/')}`
  report.probeEnvironment = await evaluate(`import(${JSON.stringify(probeModule)}).then(module=>module.checkProbeEnvironment())`)
  report.updates = await evaluate('__PIPELINE_CASES__.checkRuntimeUpdates(__RANGE_ROOM__)')
  report.cycles = await evaluate('__PIPELINE_CASES__.checkResourceCycles(__RANGE_ROOM__)')
  report.aoQuality = await evaluate('__PIPELINE_CASES__.compareAOQuality(__RANGE_ROOM__)')
  report.benchmark = await evaluate('__PIPELINE_CASES__.benchmarkPipeline(__RANGE_ROOM__)')
  await send('Emulation.setDeviceMetricsOverride', {
    width: 959,
    height: 539,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await frames(3)
  await evaluate('__RANGE_ROOM__.render.update()')
  report.oddResize = await evaluate('__RANGE_ROOM__.snapshot().pipeline')
  if (report.oddResize.ao.width !== 480 || report.oddResize.denoise.width !== 479 || report.oddResize.denoise.height !== 269)
    throw new Error('Odd-sized resolution rounding failed')
  await evaluate('__RANGE_ROOM__.engine.destroy()')
  if (report.errors.length)
    throw new Error('GPU/browser errors detected')
  report.passed = true
}
catch (error) {
  report.passed = false
  report.failure = error.stack
  process.exitCode = 1
}
finally {
  fs.mkdirSync(output, { recursive: true })
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({
    passed: report.passed,
    errors: report.errors,
    failure: report.failure,
    standalone: report.standalone,
    normals: report.normals,
    lightmapMaterial: report.lightmapMaterial,
    pixelArtMinification: report.pixelArtMinification,
    probeEnvironment: report.probeEnvironment,
    aoQuality: report.aoQuality,
    resourceCycles: report.cycles?.cycles,
    benchmark: report.benchmark?.map(({ effects, samples, gpuMs, cpuSubmitMs, passes }) => ({
      effects,
      samples,
      gpuMs,
      cpuSubmitMs,
      passes,
    })),
    report: path.join(output, 'report.json'),
  }, null, 2))
  session?.close()
}
