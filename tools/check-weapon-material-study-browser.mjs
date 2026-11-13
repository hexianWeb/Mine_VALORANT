import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { openBrowser } from './browser-session.mjs'

const output = path.resolve(process.env.WEAPON_STUDY_OUTPUT ?? 'D:/opencode-temp/opencode/weapon-material-study/check')
const url = new URL(process.argv[2] ?? 'http://127.0.0.1:5173/')
url.searchParams.set('weaponStudy', '1')
url.searchParams.set('editor', '0')
url.searchParams.set('profile', '1')
const report = { url: url.href, errors: [], messages: [] }
function phase(name) {
  report.stage = name
  fs.mkdirSync(output, { recursive: true })
  fs.writeFileSync(path.join(output, 'progress.json'), JSON.stringify(report, null, 2))
}
phase('browser-start')
const session = await openBrowser({ output, errors: report.errors, messages: report.messages })
const wait = expression => session.evaluate(`new Promise((resolve,reject)=>{const end=performance.now()+110000;function tick(){if(${expression})return resolve(true);if(performance.now()>end)return reject(new Error('Study readiness timeout: '+${JSON.stringify(expression)}));requestAnimationFrame(tick)}tick()})`)
const ready = () => wait(`globalThis.__RANGE_ROOM__?.ready && __RANGE_ROOM__.inspection.player.snapshot().weapons.view.action === 'idle' && __RANGE_ROOM__.inspection.player.snapshot().weapons.view.playback.current.weight > .999`)
async function shot(name) {
  await session.evaluate('__RANGE_ROOM__.render.update()')
  const image = await session.send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(output, name), Buffer.from(image.data, 'base64'))
}
try {
  await session.send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 720,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await session.navigate(url.href)
  phase('startup')
  await ready()
  await session.evaluate('__RANGE_ROOM__.engine.pause()')
  await session.evaluate('globalThis.__STUDY_API__=__RANGE_ROOM__.world.weaponStudy')
  const modulePath = `/@fs/${path.resolve('tests/weapon-material-study-browser-cases.js').replaceAll('\\', '/')}`
  await session.evaluate(`import(${JSON.stringify(modulePath)}).then(m=>{globalThis.__STUDY_TEST__=m;return true})`)
  phase('cube-directions')
  report.directions = await session.evaluate('__STUDY_TEST__.checkReflectionDirections(__RANGE_ROOM__)')
  phase('gun-lighting')
  report.lighting = await session.evaluate('__STUDY_TEST__.checkWeaponMaterialStudy(__RANGE_ROOM__)')
  phase('screenshots')
  await session.evaluate('__RANGE_ROOM__.world.weaponStudy.setLighting({enabled:false})')
  await shot('00-current-look.png')
  await session.evaluate('__RANGE_ROOM__.world.weaponStudy.setLighting({enabled:true,source:"indoor"})')
  await shot('01-metal-indoor.png')
  await session.evaluate('__RANGE_ROOM__.world.weaponStudy.setLighting({source:"sky"})')
  await shot('02-metal-sky.png')
  await session.evaluate('__RANGE_ROOM__.world.weaponStudy.setLighting({source:"off"})')
  await shot('03-metal-no-environment.png')
  await session.evaluate('__RANGE_ROOM__.world.weaponStudy.setLighting({source:"indoor"})')
  report.gpu = []
  phase('gpu-samples')
  for (let i = 0; i < 12; i++) {
    await session.frames(2)
    await session.evaluate('__RANGE_ROOM__.render.update()')
    report.gpu.push(await session.evaluate('__RANGE_ROOM__.render.measureGpu()'))
  }
  report.actions = {}
  for (const action of ['inspect', 'reload']) {
    phase(action)
    if (action === 'reload') {
      await session.evaluate(`(()=>{const app=__RANGE_ROOM__;app.engine.resume();app.inspection.player.weapons.queue({type:'fire'})})()`)
      await session.frames(20)
      await session.evaluate('__RANGE_ROOM__.engine.pause()')
      assert.equal(await session.evaluate('__RANGE_ROOM__.inspection.player.snapshot().weapons.view.weapon.magazine'), 11)
    }
    await session.evaluate(`(()=>{const app=__RANGE_ROOM__;app.engine.resume();app.inspection.player.weapons.queue({type:${JSON.stringify(action)}})})()`)
    const role = action === 'reload'
      ? 'reloadTactical'
      : 'inspect'
    await wait(`__RANGE_ROOM__.inspection.player.snapshot().weapons.view.action === ${JSON.stringify(role)}`)
    await session.frames(8)
    await session.evaluate('__RANGE_ROOM__.engine.pause()')
    report.actions[action] = await session.evaluate('__RANGE_ROOM__.inspection.player.snapshot().weapons.view.action')
    assert.equal(report.actions[action], role)
    await shot(`04-${action}.png`)
    await session.evaluate('__RANGE_ROOM__.engine.resume()')
    await ready()
    await session.evaluate('__RANGE_ROOM__.engine.pause()')
  }
  const state = () => session.evaluate('__STUDY_API__.getDebugState()')
  const switchWeapon = async (slotId, id) => {
    await session.evaluate(`(()=>{const a=__RANGE_ROOM__;a.engine.resume();a.inspection.player.weapons.queue({type:'selectSlot',slotId:${JSON.stringify(slotId)}})})()`)
    await wait(`__RANGE_ROOM__.inspection.player.snapshot().weapons.view.renderActiveId === ${JSON.stringify(id)}`)
    await ready()
    await session.evaluate('__RANGE_ROOM__.engine.pause()')
  }
  const setSkin = async (skinId) => {
    await session.evaluate(`(()=>{const a=__RANGE_ROOM__;a.engine.resume();a.inspection.player.weapons.queue({type:'setSkin',instanceId:'pistol',skinId:${JSON.stringify(skinId)}})})()`)
    await wait(`__RANGE_ROOM__.inspection.player.snapshot().weapons.view.skinId === ${JSON.stringify(skinId)}`)
    await session.evaluate('__RANGE_ROOM__.engine.pause()')
  }
  await setSkin('sakura')
  phase('skin-and-switch')
  const material = () => session.evaluate(`(()=>{let m;__RANGE_ROOM__.render.viewmodel.scene.traverse(o=>{if(o.visible&&o.material?.name==='Weapon_Skin')m=o.material});return {metalness:m?.metalness,emission:m?.emissiveIntensity,flat:m?.flatShading,clearcoat:m?.clearcoat}})()`)
  report.otherSkin = await material()
  assert.equal(report.otherSkin.metalness, 0.8)
  await setSkin('ag')
  await switchWeapon('primary', 'rifle')
  await switchWeapon('secondary', 'pistol')
  report.returned = await material()
  assert.equal(report.returned.metalness, 1)
  assert.equal(report.returned.emission, 0)
  assert.equal(report.returned.clearcoat, 0)
  assert.equal(report.returned.flat, true)
  report.study = await state()
  assert.equal(report.study.attachments, 1)
  assert.equal(report.study.reflection.captures, 0)
  phase('dispose')
  await session.evaluate('__RANGE_ROOM__.engine.destroy()')
  report.released = await state()
  assert.equal(report.released.attachments, 0)
  assert.equal(report.released.reflection.ready, false)
  assert.deepEqual(report.errors, [])
  report.passed = true
}
catch (error) {
  report.passed = false
  report.failure = error.stack
  phase('failed')
  const image = await session.send('Page.captureScreenshot', { format: 'png' }).catch(() => null)
  if (image)
    fs.writeFileSync(path.join(output, 'failure.png'), Buffer.from(image.data, 'base64'))
  process.exitCode = 1
}
finally {
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({
    passed: report.passed,
    failure: report.failure,
    errors: report.errors,
    lighting: report.lighting,
    report: path.join(output, 'report.json'),
  }, null, 2))
  session.close()
}
