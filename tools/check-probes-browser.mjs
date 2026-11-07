import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { openBrowser } from './browser-session.mjs'

const output = process.env.ROOM_TEST_OUTPUT ?? 'D:/opencode-temp/opencode/light-probes/browser'
const url = new URL(process.argv[2] ?? 'http://127.0.0.1:5173/')
url.searchParams.set('profile', '1')
const report = { url: url.href, errors: [], messages: [] }
const session = await openBrowser({ output, errors: report.errors, messages: report.messages })
try {
  const { evaluate, send, frames } = session
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await session.navigate(url.href)
  await evaluate(`new Promise((resolve,reject)=>{
    const deadline=performance.now()+100000;
    function check(){
      const error=document.querySelector('.unsupported');
      if(error&&!error.hidden)return reject(new Error(error.textContent));
      if(globalThis.__RANGE_ROOM__?.ready)return resolve(true);
      if(performance.now()>deadline)return reject(new Error('Room timeout'));
      requestAnimationFrame(check);
    }check();
  })`)
  await evaluate('__RANGE_ROOM__.inspection.setPaused(true)')
  await frames(30)
  report.initial = await evaluate('__RANGE_ROOM__.snapshot()')
  assert.equal(report.initial.probes.source, 'precomputed')
  assert.equal(report.initial.probes.total, 282)
  const screenshot = async (name) => {
    const image = await send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(output, name), Buffer.from(image.data, 'base64'))
  }
  await screenshot('panel.png')
  // Change actual Tweakpane DOM controls, rather than only exercising the public API.
  await evaluate(`globalThis.__LPV_UI__=(label,value)=>{
    const row=[...document.querySelectorAll('.tp-lblv')].find(r=>r.querySelector('.tp-lblv_l')?.textContent===label);
    if(!row)throw new Error('Missing LPV control '+label);
    const input=row.querySelector('input');
    if(input.type==='checkbox'){if(input.checked!==value)input.click();}
    else {input.value=String(value);input.dispatchEvent(new Event('change',{bubbles:true}));}
  }`)
  await evaluate(`__LPV_UI__('室内强度',0.7);__LPV_UI__('天空漫反射',0.2);__LPV_UI__('天空镜面反射',0.6);__LPV_UI__('实时顶灯倍率',0.8)`)
  report.ui = await evaluate('__RANGE_ROOM__.world.probes.getDebugState()')
  assert.ok(Math.abs(report.ui.volumes.find(v => v.id === 'LPV_Room').intensity - 0.7) < 1e-6)
  assert.ok(Math.abs(report.ui.skyDiffuse - 0.2) < 1e-6)
  assert.ok(Math.abs(report.ui.skySpecular - 0.6) < 1e-6)
  assert.ok(Math.abs(report.ui.direct - 0.8) < 1e-6)
  assert.equal(report.ui.dirty, false)
  await evaluate(`__RANGE_ROOM__.world.probes.reset();document.querySelector('.debug-panel').hidden=true;document.querySelector('.room-inspection').hidden=true`)
  await frames(8)
  await screenshot('probes-on.png')
  await evaluate(`(async()=>{
    const a=__RANGE_ROOM__, baked=[],realtime=[];
    for(let y=80;y<1040;y+=90)for(let x=80;x<1880;x+=120){
      const p=a.pickPixel(x,y);const list=['lightmap','baked-appearance'].includes(p?.mode)?baked:p?.mode==='realtime'?realtime:null;
      if(list&&list.length<50)list.push({x,y,name:p.name});
    }
    const sample=async points=>Promise.all(points.map(p=>a.render.readLinearPixel(p.x,p.y)));
    globalThis.__LPV_PIXELS__={baked,realtime,sample,bakedOn:await sample(baked),realtimeOn:await sample(realtime)};
    a.world.probes.setLighting({enabled:false});
  })()`)
  await frames(10)
  await screenshot('probes-off.png')
  report.isolation = await evaluate(`(async()=>{
    const s=__LPV_PIXELS__;
    const bakedOff=await s.sample(s.baked), realtimeOff=await s.sample(s.realtime);
    const delta=(a,b)=>Math.max(...a.flatMap((p,i)=>p.slice(0,3).map((v,c)=>Math.abs(v-b[i][c]))));
    return {bakedCount:s.baked.length,realtimeCount:s.realtime.length,bakedDelta:delta(s.bakedOn,bakedOff),realtimeDelta:delta(s.realtimeOn,realtimeOff)};
  })()`)
  assert.ok(report.isolation.bakedCount > 0 && report.isolation.realtimeCount > 0)
  assert.ok(report.isolation.bakedDelta < 0.0001)
  assert.ok(report.isolation.realtimeDelta > 0.001)
  await evaluate(`__RANGE_ROOM__.world.probes.setLighting({enabled:true,showBounds:true,showProbes:true})`)
  await frames(8)
  await screenshot('volumes-and-probes.png')
  report.helpers = await evaluate(`(()=>{
    const found=[];__RANGE_ROOM__.scene.traverse(o=>{if(o.userData.probeHelper)found.push(o.name)});
    return found;
  })()`)
  assert.equal(report.helpers.length, 6)
  await evaluate(`__RANGE_ROOM__.world.probes.setLighting({showBounds:false,showProbes:false})`)
  // Isolated pipeline timings after each shader configuration has warmed up.
  report.benchmark = await evaluate(`(async()=>{
    const {engine,render,world}=__RANGE_ROOM__;engine.pause();
    const samples={off:[],on:[]};
    if(render.renderer.hasFeature('timestamp-query')){
      for(const enabled of [false,true]){
        world.probes.setLighting({enabled});
        for(let i=0;i<6;i++){await new Promise(requestAnimationFrame);render.update();await render.measureGpu();}
      }
      for(let pair=0;pair<16;pair++){
        for(const enabled of (pair%2?[true,false]:[false,true])){
          world.probes.setLighting({enabled});
          await new Promise(requestAnimationFrame);render.update();const t=await render.measureGpu();
          if(t)samples[enabled?'on':'off'].push(t);
        }
      }
    }
    engine.resume();return samples;
  })()`)
  await evaluate(`document.querySelector('.debug-panel').hidden=false;__LPV_UI__('捕获灯带自发光',0.5)`)
  report.pending = await evaluate('__RANGE_ROOM__.world.probes.getDebugState()')
  assert.equal(report.pending.dirty, true)
  assert.equal(report.pending.lastCapture.emissive, 0)
  await evaluate(`globalThis.__LPV_CACHE__=__RANGE_ROOM__.world.probes.exportData()`)
  await evaluate(`[...document.querySelectorAll('.debug-panel button')].find(b=>b.textContent==='重新捕获探针').click()`)
  await evaluate(`new Promise((resolve,reject)=>{
    function check(){const s=__RANGE_ROOM__.world.probes.getDebugState();if(s.busy)return requestAnimationFrame(check);if(s.error)return reject(new Error(s.error));resolve(true)}check();
  })`)
  report.recapture = await evaluate(`(()=>{
    const p=__RANGE_ROOM__.world.probes, current=p.exportData();
    const changed=current.volumes.reduce((n,v,i)=>n+v.data.filter((x,j)=>x!==__LPV_CACHE__.volumes[i].data[j]).length,0);
    return {state:p.getDebugState(),changed};
  })()`)
  assert.equal(report.recapture.state.dirty, false)
  assert.equal(report.recapture.state.lastCapture.emissive, 0.5)
  assert.ok(report.recapture.changed > 0)
  // Restore defaults, then verify repeated captures don't feed themselves or grow resources.
  report.repeat = await evaluate(`(async()=>{
    const a=__RANGE_ROOM__;a.world.probes.reset();await a.world.probes.rebake();
    const first=a.world.probes.exportData();const before={...a.render.renderer.info.memory};
    await a.world.probes.rebake();const second=a.world.probes.exportData();
    const changed=first.volumes.reduce((n,v,i)=>n+v.data.filter((x,j)=>x!==second.volumes[i].data[j]).length,0);
    return {changed,before,after:{...a.render.renderer.info.memory},state:a.world.probes.getDebugState()};
  })()`)
  assert.equal(report.repeat.changed, 0)
  assert.equal(report.repeat.after.textures, report.repeat.before.textures)
  report.failureRecovery = await evaluate(`(async()=>{
    const a=__RANGE_ROOM__;a.engine.pause();const r=a.render.renderer,p=a.world.probes;
    const before=JSON.stringify(p.exportData());const render=r.render;const toneMapping=r.toneMapping,outputColorSpace=r.outputColorSpace;
    let caught=false;
    try{r.render=()=>{throw new Error('injected probe capture failure')};await p.rebake();}
    catch(e){caught=e.message==='injected probe capture failure'}
    finally{r.render=render}
    const result={caught,preserved:JSON.stringify(p.exportData())===before,toneMapping:r.toneMapping===toneMapping,outputColorSpace:r.outputColorSpace===outputColorSpace,busy:p.getDebugState().busy};
    p.reset();a.engine.resume();return result;
  })()`)
  assert.deepEqual(report.failureRecovery, {
    caught: true,
    preserved: true,
    toneMapping: true,
    outputColorSpace: true,
    busy: false,
  })
  // An upload failure after one completed atlas must restore actual GPU data too.
  report.uploadRecovery = await evaluate(`(async()=>{
    const a=__RANGE_ROOM__;a.engine.pause();const r=a.render.renderer,p=a.world.probes;
    const before=JSON.stringify(p.exportData());
    const grids=p.exportData().volumes.map(v=>p.root.getObjectByName(v.id));
    const textures=grids.map(g=>g.texture);
    const read=async()=>{
      const values=[];
      for(const grid of grids){
        const {width,height,depth}=grid.texture.image;
        for(let z=0;z<depth;z++)values.push(...await r.readRenderTargetPixelsAsync(grid._renderTarget,0,0,width,height,0,z));
      }
      return JSON.stringify(values);
    };
    const gpuBefore=await read();const copy=r.copyTextureToTexture;
    let caught=false,uploads=0;
    p.setCapture({sky:4,emissive:1});
    try{
      r.copyTextureToTexture=function(...args){
        if(textures.includes(args[1])&&++uploads===2)throw new Error('injected probe upload failure');
        return copy.apply(this,args);
      };
      await p.rebake();
    }
    catch(e){caught=e.message==='injected probe upload failure'}
    finally{r.copyTextureToTexture=copy}
    const result={caught,preserved:JSON.stringify(p.exportData())===before,gpuPreserved:await read()===gpuBefore,textureIdentity:grids.every((g,i)=>g.texture===textures[i]),busy:p.getDebugState().busy,dirty:p.getDebugState().dirty};
    p.reset();a.engine.resume();return result;
  })()`)
  assert.deepEqual(report.uploadRecovery, {
    caught: true,
    preserved: true,
    gpuPreserved: true,
    textureIdentity: true,
    busy: false,
    dirty: true,
  })
  await frames(8)
  report.disposal = await evaluate(`(async()=>{
    const a=__RANGE_ROOM__;a.engine.pause();const pending=a.world.probes.rebake();
    a.world.probes.dispose();let aborted=false;
    try{await pending}catch(e){aborted=e.name==='AbortError'}
    const removed=!a.scene.getObjectByName('LightProbeVolumes');a.engine.destroy();return {aborted,removed};
  })()`)
  assert.deepEqual(report.disposal, { aborted: true, removed: true })
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
    isolation: report.isolation,
    recapture: report.recapture?.state.lastBakeMs,
    repeat: report.repeat,
    failureRecovery: report.failureRecovery,
    uploadRecovery: report.uploadRecovery,
    disposal: report.disposal,
  }, null, 2))
  session.close()
}
