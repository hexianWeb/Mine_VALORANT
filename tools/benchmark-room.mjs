import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { openBrowser } from './browser-session.mjs'

// Run URLs sequentially so baseline and candidate never contend for GPU time.
const urls = process.argv.slice(2)
if (!urls.length)
  urls.push('http://127.0.0.1:5173/')
const output = path.resolve(process.env.ROOM_TEST_OUTPUT ?? 'D:/opencode-temp/opencode/render-v2/comparison')
const report = {
  viewport: [1920, 1080],
  samples: 40,
  warmup: 20,
  results: [],
}
for (const [index, address] of urls.entries()) {
  let session
  const url = new URL(address)
  url.searchParams.set('profile', '1')
  const result = { url: url.href, errors: [], messages: [] }
  try {
    session = await openBrowser({
      output: path.join(output, String(index)),
      errors: result.errors,
      messages: result.messages,
    })
    const { send, evaluate, frames, navigate } = session
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await navigate(url.href)
    await evaluate(`new Promise((resolve,reject)=>{
      const deadline=performance.now()+100000;
      function check(){
        const error=document.querySelector('.unsupported');
        if(error&&!error.hidden)return reject(new Error(error.textContent));
        if(globalThis.__RANGE_ROOM__?.ready)return resolve(true);
        if(performance.now()>deadline)return reject(new Error('Room readiness timeout'));
        requestAnimationFrame(check);
      }check();
    })`)
    await frames(35)
    result.adapter = await evaluate('(async()=>{const adapter=await navigator.gpu.requestAdapter();return {vendor:adapter.info.vendor,architecture:adapter.info.architecture}})()')
    result.timing = await evaluate(`(async()=>{
      const {engine,render}=__RANGE_ROOM__;engine.pause();
      if(!render.renderer.hasFeature('timestamp-query'))throw new Error('GPU timestamps unavailable');
      const gpu=[],cpu=[];
      await render.renderer.resolveTimestampsAsync('render');
      for(let i=0;i<${report.samples + report.warmup};i++){
        await new Promise(requestAnimationFrame);
        const started=performance.now();render.update();const cpuMs=performance.now()-started;
        if(render.renderer.info.render.frameCalls<2)throw new Error('Cached frame is not a valid sample');
        const gpuMs=await render.renderer.resolveTimestampsAsync('render');
        if(i>=${report.warmup}){gpu.push(gpuMs);cpu.push(cpuMs)}
      }
      const stats=values=>{const sorted=[...values].sort((a,b)=>a-b);return {p50:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)],samples:values.length}};
      return {gpuMs:stats(gpu),cpuSubmitMs:stats(cpu),gpuSamples:gpu};
    })()`)
    result.snapshot = await evaluate('__RANGE_ROOM__.snapshot()')
    await evaluate('__RANGE_ROOM__.engine.destroy()')
    if (result.errors.length)
      throw new Error('Browser errors during benchmark')
    result.passed = true
  }
  catch (error) {
    result.passed = false
    result.failure = error.stack
    process.exitCode = 1
  }
  finally {
    session?.close()
    report.results.push(result)
  }
}
fs.mkdirSync(output, { recursive: true })
fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({
  report: path.join(output, 'report.json'),
  results: report.results.map(result => ({
    url: result.url,
    passed: result.passed,
    errors: result.errors,
    failure: result.failure,
    adapter: result.adapter,
    timing: result.timing && { gpuMs: result.timing.gpuMs, cpuSubmitMs: result.timing.cpuSubmitMs },
    memoryBytes: result.snapshot?.memory.total,
    drawCalls: result.snapshot?.render.drawCalls,
  })),
}, null, 2))
