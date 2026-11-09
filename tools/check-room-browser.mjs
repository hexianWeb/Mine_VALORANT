import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { openBrowser } from './browser-session.mjs'

// Native CDP: no test dependency or browser profile added to the project.
const output = path.resolve(process.env.ROOM_TEST_OUTPUT ?? 'D:/opencode-temp/opencode/range-room-browser')
fs.mkdirSync(output, { recursive: true })
let session
const errors = []
const messages = []
const report = { url: process.argv[2] ?? process.env.ROOM_TEST_URL ?? 'http://127.0.0.1:5173/', errors }
const url = new URL(report.url)
url.searchParams.set('profile', '1')
url.searchParams.set('player', '0')
report.url = url.href
try {
  session = await openBrowser({ output, errors, messages })
  const { send, evaluate, navigate } = session
  await send('Emulation.setDeviceMetricsOverride', {
    width: 960,
    height: 540,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await navigate(report.url)
  await evaluate(`new Promise((resolve, reject) => {
    const deadline = performance.now() + 100000;
    function check() {
      const error = document.querySelector('.unsupported');
      if (error && !error.hidden) return reject(new Error(error.textContent));
      if (globalThis.__RANGE_ROOM__?.ready) return resolve(true);
      if (performance.now() > deadline) return reject(new Error('Room readiness timeout'));
      requestAnimationFrame(check);
    }
    check();
  })`)
  const frames = count => evaluate(`new Promise(resolve => { let n=${count}; function tick(){ if(--n<=0) resolve(true); else requestAnimationFrame(tick); } requestAnimationFrame(tick); })`)
  // Renderer-only image comparisons exclude animated props and colored HUD pixels.
  await evaluate('__RANGE_ROOM__.inspection.setPaused(true);document.querySelector(".room-inspection").hidden=true')
  await frames(35)
  report.baseline = await evaluate('globalThis.__RANGE_ROOM__.snapshot()')
  report.lightingMode = report.baseline.lightingMode
  report.lightingSwitch = await evaluate('({text:document.querySelector(".debug-lighting")?.textContent,href:document.querySelector(".debug-lighting a")?.href})')
  if (report.baseline.toneMapping !== 2 || report.baseline.exposure !== 1.11 || !report.baseline.skybox)
    throw new Error('Expected Reinhard, exposure 1.11 and skybox-day')
  if (report.baseline.sampling.atlasMipLevels.some(count => count !== 3) || report.baseline.sampling.anisotropy < 1)
    throw new Error('Linear/aniso atlas sampling was not configured')
  if (!report.baseline.sampling.atlasDecoders.every(decode => decode.worker))
    throw new Error('Atlas decode/mip generation must run in Workers')
  if (report.baseline.pipeline.denoise.depthBuffer || report.baseline.pipeline.aaInput.depthBuffer)
    throw new Error('Fullscreen effect targets must not allocate depth')
  if (report.baseline.environmentSize[0] > 1024 || report.baseline.lights.some(light => light.type === 'PointLight'))
    throw new Error('Expected bounded sky lighting and no corridor fill lights')
  report.surfaceSampling = await evaluate(`(()=>{
    const samplers=__RANGE_ROOM__.room.samplers.snapshot();
    const surfaces=samplers.filter(texture=>texture.role==='voxel-surface');
    const nearest=surfaces.filter(texture=>texture.sampling==='nearest');
    const minified=surfaces.filter(texture=>texture.sampling==='pixel-art-mip-anisotropic');
    const atlases=samplers.filter(texture=>texture.role==='baked-atlas');
    return {
      surfaceCount:surfaces.length,atlasCount:atlases.length,
      nearestSurfaces:nearest.every(texture=>texture.magFilter===1003&&texture.minFilter===1003&&texture.anisotropy===1&&texture.mipLevels===1),
      lightmapAlbedoCount:minified.length,
      filteredAlbedo:minified.every(texture=>texture.magFilter===1006&&texture.minFilter===1008&&texture.anisotropy===__RANGE_ROOM__.snapshot().sampling.anisotropy&&texture.mipLevels>1),
      linearAtlases:atlases.every(texture=>texture.magFilter===1006&&texture.minFilter===1008&&texture.mipLevels===3)
    };
  })()`)
  if (!report.surfaceSampling.surfaceCount || !report.surfaceSampling.nearestSurfaces || !report.surfaceSampling.linearAtlases || !report.surfaceSampling.filteredAlbedo || (report.lightingMode === 'lightmap' && !report.surfaceSampling.lightmapAlbedoCount))
    throw new Error('Expected pixel-sharp mipmapped lightmap albedo, nearest realtime surfaces and linear atlases')
  report.camera = await evaluate('({position:__RANGE_ROOM__.camera.position.toArray(),quaternion:__RANGE_ROOM__.camera.quaternion.toArray(),reference:__RANGE_ROOM__.room.manifest.camera})')
  const positionDelta = Math.max(...report.camera.position.map((v, i) => Math.abs(v - report.camera.reference.position[i])))
  const rotationDot = Math.abs(report.camera.quaternion.reduce((sum, v, i) => sum + v * report.camera.reference.quaternion[i], 0))
  if (positionDelta > 1e-5 || Math.abs(rotationDot - 1) > 1e-5)
    throw new Error('Inspection controls changed the reference camera pose')
  report.adapter = await evaluate('(async()=>{const a=await navigator.gpu.requestAdapter();return a?{vendor:a.info.vendor,architecture:a.info.architecture,device:a.info.device,description:a.info.description}:null})()')
  const screenshot = async (name) => {
    const image = await send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(output, name), Buffer.from(image.data, 'base64'))
  }
  // Inspect the displayed output, not the HDR target (which intentionally excludes the LUT).
  const displayProbe = async () => {
    const image = await send('Page.captureScreenshot', { format: 'png' })
    return evaluate(`(async()=>{
      const bitmap=await createImageBitmap(await (await fetch('data:image/png;base64,${image.data}')).blob());
      const canvas=new OffscreenCanvas(bitmap.width,bitmap.height);const ctx=canvas.getContext('2d');
      ctx.drawImage(bitmap,0,0);bitmap.close();const {data}=ctx.getImageData(0,0,canvas.width,canvas.height);
      const samples=[];const width=Math.max(100,canvas.width-360);
      for(let y=20;y<canvas.height-20;y+=Math.max(1,Math.floor(canvas.height/16))){
        for(let x=20;x<width;x+=Math.max(1,Math.floor(width/24))){
          const i=(y*canvas.width+x)*4;samples.push([data[i],data[i+1],data[i+2]]);
        }
      }
      return samples;
    })()`)
  }
  const displayDelta = (a, b) => a.reduce((sum, pixel, index) => sum + pixel.reduce((delta, value, channel) => delta + Math.abs(value - b[index][channel]), 0), 0) / (a.length * 3)
  await screenshot('room-gtao-smaa.png')
  report.pixelIsolation = await evaluate(`(async()=>{
    const app=__RANGE_ROOM__;const baked=[];const realtime=[];
    for(let y=40;y<530;y+=70)for(let x=40;x<950;x+=90){
      const pick=app.pickPixel(x,y);
       const list=['baked-appearance','lightmap'].includes(pick?.mode)?baked:pick?.mode==='realtime'?realtime:null;
       if(list&&list.length<24)list.push({x,y,name:pick.name});
    }
    if(!baked.length||!realtime.length)throw new Error('No visible receivers for pixel isolation test');
    const sample=async points=>{const result=[];for(const p of points)result.push(await app.render.readLinearPixel(p.x,p.y));return result};
    globalThis.__ROOM_PIXEL_CHECK__={baked,realtime,beforeAO:await sample(baked),realtimeBeforeAO:await sample(realtime),sample};
    return {baked,realtime};
  })()`)
  await evaluate('__RANGE_ROOM__.render.setEffects({ao:false,aa:"smaa"})')
  await frames(8)
  await evaluate(`(async()=>{
    const state=__ROOM_PIXEL_CHECK__;
    state.afterAO=await state.sample(state.baked);
    state.beforeLighting=await state.sample(state.realtime);
    __RANGE_ROOM__.world.setRuntimeLighting(false);
  })()`)
  await frames(8)
  report.pixelIsolation.results = await evaluate(`(async()=>{
    const state=__ROOM_PIXEL_CHECK__;
    const bakedDark=await state.sample(state.baked);
    const realtimeDark=await state.sample(state.realtime);
    const delta=(a,b)=>Math.max(...a.flatMap((p,i)=>p.slice(0,3).map((v,c)=>Math.abs(v-b[i][c]))));
    const result={bakedAODelta:delta(state.beforeAO,state.afterAO),realtimeAODelta:delta(state.realtimeBeforeAO,state.beforeLighting),bakedLightingDelta:delta(state.afterAO,bakedDark),realtimeLightingDelta:delta(state.beforeLighting,realtimeDark)};
    __RANGE_ROOM__.world.setRuntimeLighting(true);
    delete globalThis.__ROOM_PIXEL_CHECK__;
    return result;
  })()`)
  const atlasAOFailed = report.lightingMode === 'lightmap'
    ? report.pixelIsolation.results.bakedAODelta < 0.00001
    : report.pixelIsolation.results.bakedAODelta > 0.001
  if (atlasAOFailed || report.pixelIsolation.results.bakedLightingDelta > 0.001 || report.pixelIsolation.results.realtimeLightingDelta < 0.001 || report.pixelIsolation.results.realtimeAODelta < 0.00001)
    throw new Error('Baked/realtime lighting or AO isolation failed')
  await evaluate('__RANGE_ROOM__.render.setEffects({ao:true,aa:"smaa"})')
  await frames(6)
  report.gpuBenchmark = await evaluate(`(async()=>{
    const {engine, render}=__RANGE_ROOM__;
    engine.pause();
    const supported=render.renderer.hasFeature('timestamp-query');
    const variants=[];
    if(supported){
      await render.renderer.resolveTimestampsAsync('render');
      for(const effects of [{ao:true,aa:'smaa'},{ao:false,aa:'smaa'},{ao:false,aa:'none'}]){
        render.setEffects(effects);
        await new Promise(requestAnimationFrame);
        render.update();
        await render.renderer.resolveTimestampsAsync('render');
        const gpuMs=[];
        for(let i=0;i<12;i++){
          await new Promise(requestAnimationFrame);
          render.update();
          if(render.renderer.info.render.frameCalls<2) throw new Error('Cached frame cannot be used for a GPU pipeline benchmark');
          gpuMs.push(await render.renderer.resolveTimestampsAsync('render'));
        }
        gpuMs.sort((a,b)=>a-b);
        variants.push({effects,samples:gpuMs.length,p50:gpuMs[6],p95:gpuMs[11]});
      }
    }
    engine.resume();
    return {supported,unit:'GPU milliseconds per whole pipeline frame; variants are not isolated pass timings',variants};
  })()`)
  await evaluate('globalThis.__RANGE_ROOM__.render.setEffects({ao:false,aa:"none"})')
  await frames(8)
  report.withoutEffects = await evaluate('globalThis.__RANGE_ROOM__.snapshot()')
  await screenshot('room-no-ao-no-aa.png')
  await send('Emulation.setDeviceMetricsOverride', {
    width: 800,
    height: 600,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await frames(8)
  report.resized = await evaluate('globalThis.__RANGE_ROOM__.snapshot().viewport')
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await evaluate('__RANGE_ROOM__.render.setEffects({ao:true,aa:"smaa"})')
  await frames(12)
  report.fullHd = await evaluate('__RANGE_ROOM__.snapshot()')
  report.fullHdGpu = await evaluate(`(async()=>{
    const {engine,render}=__RANGE_ROOM__; engine.pause();
    const gpuMs=[];
    if(render.renderer.hasFeature('timestamp-query')){
      await render.renderer.resolveTimestampsAsync('render');
      for(let i=0;i<12;i++){
        await new Promise(requestAnimationFrame); render.update();
        gpuMs.push(await render.renderer.resolveTimestampsAsync('render'));
      }
    }
    engine.resume(); gpuMs.sort((a,b)=>a-b);
    return {samples:gpuMs.length,p50:gpuMs[6]??null,p95:gpuMs[11]??null,unit:'GPU milliseconds per whole pipeline frame'};
  })()`)
  await screenshot('room-fullhd-gtao-smaa.png')
  await evaluate(`(()=>{
    globalThis.__ROOM_UI_CHANGE__=(label,value)=>{
      const row=[...document.querySelectorAll('.tp-lblv')].find(row=>row.querySelector('.tp-lblv_l')?.textContent===label);
      if(!row)throw new Error('Missing panel row: '+label);
      const input=row.querySelector('select,input');if(!input)throw new Error('Missing control: '+label);
      if(input.tagName==='SELECT'){
        const option=[...input.options].find(option=>option.textContent===value);
        if(!option)throw new Error('Missing option: '+value);
        input.value=option.value;input.dispatchEvent(new Event('change',{bubbles:true}));
      }else if(input.type==='checkbox'){
        if(input.checked!==value)input.click();
      }else{
        input.value=String(value);input.dispatchEvent(new Event('change',{bubbles:true}));
      }
    };
    globalThis.__ROOM_UI_BUTTON__=title=>{
      const button=[...document.querySelectorAll('.debug-panel button')].find(button=>button.textContent===title);
      if(!button)throw new Error('Missing button: '+title);button.click();
    };
    __ROOM_UI_CHANGE__('强度',0.6);__ROOM_UI_CHANGE__('半径 / m',0.8);
    __ROOM_UI_CHANGE__('采样','8');__ROOM_UI_CHANGE__('分辨率','50%');__ROOM_UI_CHANGE__('显示','仅AO');
  })()`)
  await frames(10)
  const aoImage = await displayProbe()
  report.panel = await evaluate('({ao:__RANGE_ROOM__.render.getDebugState(),folders:__RANGE_ROOM__.panel.pane.children.map(folder=>folder.title)})')
  report.panel.aoGrayscale = aoImage.every(([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b) <= 1)
  report.panel.aoRange = [
    Math.min(...aoImage.map(pixel => pixel[0])),
    Math.max(...aoImage.map(pixel => pixel[0])),
  ]
  await evaluate('__ROOM_UI_CHANGE__("去噪分辨率","全分辨率")')
  await frames(6)
  report.panel.denoiseOverride = await evaluate('__RANGE_ROOM__.snapshot().pipeline.denoise')
  await evaluate('__ROOM_UI_CHANGE__("去噪分辨率","跟随AO")')
  await frames(6)
  report.panel.denoiseLinked = await evaluate('__RANGE_ROOM__.snapshot().pipeline.denoise')
  if (report.panel.denoiseOverride.width !== 1920 || report.panel.denoiseLinked.width !== 960)
    throw new Error('Independent/linked denoise panel controls failed')
  if (!report.panel.aoGrayscale || report.panel.aoRange[0] === report.panel.aoRange[1] || report.panel.ao.aoView !== 'ao' || report.panel.ao.aoSamples !== 8 || Math.abs(report.panel.ao.aoRadius - 0.8) > 1e-6 || Math.abs(report.panel.ao.aoStrength - 0.6) > 1e-6 || report.panel.ao.aoResolutionScale !== 0.5)
    throw new Error('AO panel changes or grayscale preview failed')
  await screenshot('room-ao-preview.png')
  await evaluate('__ROOM_UI_BUTTON__("重置 AO")')
  await frames(8)
  const authored = await displayProbe()
  await evaluate('__ROOM_UI_CHANGE__("启用 LUT",false)')
  await frames(6)
  const ungraded = await displayProbe()
  await evaluate('__ROOM_UI_CHANGE__("启用 LUT",true);__ROOM_UI_CHANGE__("预设","暖色")')
  await frames(8)
  report.panel.warmDelta = displayDelta(authored, await displayProbe())
  await screenshot('room-lut-warm.png')
  await evaluate('__ROOM_UI_CHANGE__("启用 LUT",false)')
  await frames(6)
  report.panel.disabledLutDelta = displayDelta(ungraded, await displayProbe())
  await evaluate('__ROOM_UI_CHANGE__("启用 LUT",true);__ROOM_UI_CHANGE__("曝光强度",1.5)')
  await frames(6)
  report.panel.changedExposure = await evaluate('__RANGE_ROOM__.snapshot().exposure')
  await evaluate('__ROOM_UI_BUTTON__("重置调色")')
  await frames(6)
  report.panel.resetDelta = displayDelta(authored, await displayProbe())
  report.panel.resetExposure = await evaluate('__RANGE_ROOM__.snapshot().exposure')
  const cubeRows = []
  for (let b = 0; b < 2; b++) {
    for (let g = 0; g < 2; g++) {
      for (let r = 0; r < 2; r++)
        cubeRows.push(`${r * 0.8} ${g * 0.9} ${b}`)
    }
  }
  const cube = `TITLE "Browser import"\nLUT_3D_SIZE 2\n${cubeRows.join('\n')}\n`
  await evaluate(`(()=>{
    const files=new DataTransfer();files.items.add(new File([${JSON.stringify(cube)}],'browser-test.cube',{type:'text/plain'}));
    const input=document.querySelector('.debug-panel input[type=file]');input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}));
  })()`)
  await frames(12)
  report.panel.imported = await evaluate('__RANGE_ROOM__.snapshot().colorGrading')
  report.panel.importDelta = displayDelta(authored, await displayProbe())
  await evaluate(`(()=>{
    const files=new DataTransfer();files.items.add(new File(['LUT_3D_SIZE 2\\n0 0 0'],'invalid.cube'));
    const input=document.querySelector('.debug-panel input[type=file]');input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}));
  })()`)
  await frames(6)
  report.panel.invalidImport = await evaluate('({message:document.querySelector(".debug-message").textContent,size:__RANGE_ROOM__.snapshot().colorGrading.size})')
  await evaluate('__ROOM_UI_BUTTON__("重置调色")')
  await frames(6)
  report.panel.finalResetDelta = displayDelta(authored, await displayProbe())
  if (report.panel.warmDelta < 1 || report.panel.disabledLutDelta > 1 || report.panel.resetDelta > 1 || report.panel.importDelta < 1 || report.panel.imported.size !== 2 || report.panel.invalidImport.size !== 2 || !report.panel.invalidImport.message.includes('无效') || report.panel.changedExposure !== 1.5 || report.panel.resetExposure !== report.baseline.exposure || report.panel.finalResetDelta > 1)
    throw new Error('LUT panel preset, toggle, exposure, import or reset failed')

  await evaluate(`(()=>{
    const app=__RANGE_ROOM__;
    globalThis.__ROOM_POSE__={position:app.camera.position.toArray(),target:app.controls.target.toArray()};
    app.camera.position.set(0,10.8,-10.5);app.controls.target.set(16,10.8,-10.5);app.controls.update();
    document.querySelector('.debug-panel').hidden=true;
  })()`)
  await frames(10)
  await screenshot('room-corridor.png')
  report.corridor = await evaluate(`(()=>{
    const fills=[];const pointLights=[];const helpers=[];
    __RANGE_ROOM__.scene.traverse(object=>{
      if(object.userData.role==='corridor-fill'||object.name.includes('走廊顶棚补光'))fills.push(object.name);
      if(object.isPointLight)pointLights.push(object.name);
      if(object.userData.role==='light-helper')helpers.push(object.name);
    });
    return {fills,pointLights,helpers};
  })()`)
  if (report.corridor.fills.length || report.corridor.pointLights.length || report.corridor.helpers.length)
    throw new Error('Corridor lights and their helpers must be removed from the scene')
  await evaluate(`(()=>{
    const app=__RANGE_ROOM__;app.camera.position.fromArray(__ROOM_POSE__.position);app.controls.target.fromArray(__ROOM_POSE__.target);app.controls.update();
    document.querySelector('.debug-panel').hidden=false;delete globalThis.__ROOM_POSE__;delete globalThis.__ROOM_UI_CHANGE__;delete globalThis.__ROOM_UI_BUTTON__;
  })()`)
  await evaluate(`(()=>{
    const app=__RANGE_ROOM__;
    globalThis.__ROOM_POSE__={position:app.camera.position.toArray(),target:app.controls.target.toArray()};
    app.camera.position.x+=0.75; app.controls.target.x+=0.75;
    app.camera.position.y-=0.4; app.controls.target.y-=0.4;
    app.camera.position.z+=0.75; app.controls.target.z+=0.75;
    app.controls.update();
  })()`)
  await frames(12)
  report.motion = await evaluate('({ready:__RANGE_ROOM__.snapshot().ready,position:__RANGE_ROOM__.camera.position.toArray(),state:__RANGE_ROOM__.engine.state})')
  await screenshot('room-motion-inspection.png')
  await evaluate('__RANGE_ROOM__.camera.position.fromArray(__ROOM_POSE__.position);__RANGE_ROOM__.controls.target.fromArray(__ROOM_POSE__.target);__RANGE_ROOM__.controls.update();delete globalThis.__ROOM_POSE__')
  await frames(4)
  await evaluate('globalThis.__RANGE_ROOM__.engine.destroy()')
  report.disposed = await evaluate('globalThis.__RANGE_ROOM__.snapshot().ready === false && document.querySelectorAll(".debug-panel input,.debug-panel button").length === 0')
  report.messages = messages
  if (!report.baseline.ready || errors.length || !report.disposed)
    throw new Error('Room smoke test failed; see report')
  report.passed = true
}
catch (error) {
  report.passed = false
  report.failure = error.stack
  process.exitCode = 1
}
finally {
  report.messages = messages
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({
    passed: report.passed,
    errors,
    failure: report.failure,
    report: path.join(output, 'report.json'),
    lightingMode: report.lightingMode,
    pixelIsolation: report.pixelIsolation?.results,
    exposure: report.baseline?.exposure,
    sampling: report.baseline?.sampling,
    surfaceSampling: report.surfaceSampling,
    panel: report.panel,
    corridor: report.corridor,
    fullHdGpu: report.fullHdGpu,
    fullHdMemory: report.fullHd?.memory.total,
  }, null, 2))
  session?.close()
}
