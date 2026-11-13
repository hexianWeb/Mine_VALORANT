import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { openBrowser } from './browser-session.mjs'

const output = path.resolve(process.env.WEAPON_LIGHTING_TEST_OUTPUT ?? 'D:/opencode-temp/opencode/weapon-lighting-browser')
const url = new URL(process.argv[2] ?? 'http://localhost:5173/')
url.searchParams.set('editor', '0')
url.searchParams.delete('probes')
const report = { url: url.href, errors: [], messages: [] }
let session
try {
  session = await openBrowser({ output, errors: report.errors, messages: report.messages })
  const { evaluate, send } = session
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 720,
    deviceScaleFactor: 1,
    mobile: false,
  })
  const ready = id => evaluate(`new Promise((resolve, reject) => {
    const end = performance.now() + 100000;
    function check() {
      const app = globalThis.__RANGE_ROOM__, state = app?.inspection.player?.snapshot().weapons;
      if (app?.ready && state.canAct && state.view.renderActiveId === ${JSON.stringify(id)} && state.view.action === 'idle' && state.view.playback.current.weight > .999) return resolve(true);
      if (performance.now() > end) return reject(new Error('Weapon readiness timeout'));
      requestAnimationFrame(check);
    }
    check();
  })`)
  const screenshot = async (name) => {
    await evaluate('(async () => { await new Promise(requestAnimationFrame); __RANGE_ROOM__.render.update(); })()')
    const image = await send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(output, name), Buffer.from(image.data, 'base64'))
  }
  await session.navigate(url.href)
  await ready('pistol')
  await evaluate('__RANGE_ROOM__.engine.pause()')
  const modulePath = `/@fs/${path.resolve('tests/weapon-lighting-browser-cases.js').replaceAll('\\', '/')}`
  await evaluate(`import(${JSON.stringify(modulePath)}).then(module => { globalThis.__WEAPON_LIGHTING__ = module; return true; })`)
  const skinModulePath = `/@fs/${path.resolve('tests/weapon-skin-browser-cases.js').replaceAll('\\', '/')}`
  await evaluate(`import(${JSON.stringify(skinModulePath)}).then(module => { globalThis.__WEAPON_SKINS__ = module; return true; })`)
  report.skinEmission = await evaluate('__WEAPON_SKINS__.checkWeaponSkinEmission(__RANGE_ROOM__)')
  report.classic = await evaluate('__WEAPON_LIGHTING__.checkWeaponLighting(__RANGE_ROOM__)')
  await screenshot('classic-ag.png')
  await evaluate(`(() => {
    const app = __RANGE_ROOM__; app.engine.resume();
    app.inspection.player.weapons.queue({ type: 'selectSlot', slotId: 'primary' });
  })()`)
  await ready('rifle')
  await evaluate('__RANGE_ROOM__.engine.pause()')
  report.phantom = await evaluate('__WEAPON_LIGHTING__.checkWeaponLighting(__RANGE_ROOM__)')
  await screenshot('phantom-tactiplay.png')
  await evaluate(`(() => {
    const app = __RANGE_ROOM__; app.engine.resume();
    app.inspection.player.weapons.queue({ type: 'selectSlot', slotId: 'secondary' });
    app.inspection.player.weapons.queue({ type: 'setSkin', instanceId: 'pistol', skinId: 'sakura' });
  })()`)
  await ready('pistol')
  await evaluate(`new Promise(resolve => {
    function check() {
      if (__RANGE_ROOM__.inspection.player.snapshot().weapons.view.skinId === 'sakura') return resolve(true);
      requestAnimationFrame(check);
    }
    check();
  })`)
  await evaluate('__RANGE_ROOM__.engine.pause()')
  await screenshot('classic-sakura.png')
  report.materials = await evaluate(`(() => {
    const result = [];
    __RANGE_ROOM__.render.viewmodel.scene.traverse(o => {
      if (o.material?.isMeshStandardMaterial) result.push({ name: o.material.name, roughness: o.material.roughness, metalness: o.material.metalness });
    });
    return result;
  })()`)
  const weapon = report.materials.find(material => material.name === 'Weapon_Skin')
  const profile = await evaluate('__WEAPON_LIGHTING__.weaponMaterialProfiles.weapon')
  assert.equal(weapon.roughness, profile.roughness)
  assert.equal(weapon.metalness, profile.metalness)
  await evaluate('__RANGE_ROOM__.engine.destroy()')
  assert.deepEqual(report.errors, [])
  report.passed = true
}
catch (error) {
  report.passed = false
  report.failure = error.stack
  if (session) {
    const image = await session.send('Page.captureScreenshot', { format: 'png' }).catch(() => null)
    if (image)
      fs.writeFileSync(path.join(output, 'failure.png'), Buffer.from(image.data, 'base64'))
  }
  process.exitCode = 1
}
finally {
  fs.mkdirSync(output, { recursive: true })
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({
    passed: report.passed,
    failure: report.failure,
    errors: report.errors,
    skinEmission: report.skinEmission,
    classic: report.classic,
    phantom: report.phantom,
    report: path.join(output, 'report.json'),
  }, null, 2))
  session?.close()
}
