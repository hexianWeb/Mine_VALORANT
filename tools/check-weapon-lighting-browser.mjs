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
  const ready = (id, skin) => evaluate(`new Promise((resolve, reject) => {
    const end = performance.now() + 100000;
    function check() {
      const app = globalThis.__RANGE_ROOM__, state = app?.inspection.player?.snapshot().weapons;
      if (app?.ready && state?.canAct && state.view.renderActiveId === ${JSON.stringify(id)} && state.view.skinId === ${JSON.stringify(skin)} && state.view.action === 'idle' && state.view.playback.current.weight > .999) return resolve(true);
      if (performance.now() > end) return reject(new Error('Weapon or skin readiness timeout'));
      requestAnimationFrame(check);
    }
    check();
  })`)
  const screenshot = async (name) => {
    await evaluate('(async () => { await new Promise(requestAnimationFrame); __RANGE_ROOM__.render.update(); })()')
    const image = await send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(output, name), Buffer.from(image.data, 'base64'))
  }
  const captureSkin = async (name, clearcoat) => {
    const state = await evaluate(`(() => {
      const { render, world } = __RANGE_ROOM__;
      const guns = new Set();
      render.viewmodel.scene.traverseVisible(o => {
        if (o.material?.name === 'Weapon_Skin') guns.add(o.material);
      });
      const describe = m => ({
        roughness: m.roughness, metalness: m.metalness, flatShading: m.flatShading,
        clearcoat: m.clearcoat ?? null, clearcoatRoughness: m.clearcoatRoughness ?? null,
        hasSkinEmission: m.emissiveMap === m.map && m.emissive.getHex() === 0xffffff,
        emissiveIntensity: m.emissiveIntensity,
        usesRoomReflection: m.envMap === world.reflection.texture, reflectionIntensity: m.envMapIntensity,
      });
      return Array.from(guns, describe);
    })()`)
    assert.ok(state.length > 0, `No visible gun material for ${name}`)
    for (const material of state) {
      assert.equal(material.roughness, 1)
      assert.equal(material.metalness, 1)
      assert.equal(material.flatShading, true)
      assert.equal(material.hasSkinEmission, true)
      assert.equal(material.emissiveIntensity, 0.4)
      assert.equal(material.usesRoomReflection, true)
      assert.equal(material.reflectionIntensity, 0.3)
      if (clearcoat) {
        assert.ok(Math.abs(material.clearcoat - 0.291) < 0.001)
        assert.equal(material.clearcoatRoughness, 0.18)
      }
      else {
        assert.equal(material.clearcoat, null)
      }
    }
    report.skins[name] = state
    await screenshot(`${name}.png`)
  }
  await session.navigate(url.href)
  await ready('pistol', 'ag')
  await evaluate('__RANGE_ROOM__.engine.pause()')
  report.reflection = await evaluate('__RANGE_ROOM__.snapshot().reflection')
  assert.equal(report.reflection?.ready, true)
  assert.equal(report.reflection.captures, 0)
  report.lightingSwitch = await evaluate(`(() => {
    const { render, world } = __RANGE_ROOM__;
    const gun = render.viewmodel.scene.getObjectByName('Weapon_Body').material;
    world.setRuntimeLighting(false);
    const disabled = gun.envMapIntensity;
    world.setRuntimeLighting(true);
    return { disabled, enabled: gun.envMapIntensity };
  })()`)
  assert.deepEqual(report.lightingSwitch, { disabled: 0, enabled: 0.3 })
  report.skins = {}
  await captureSkin('classic-ag', true)
  const modulePath = `/@fs/${path.resolve('tests/weapon-lighting-browser-cases.js').replaceAll('\\', '/')}`
  await evaluate(`import(${JSON.stringify(modulePath)}).then(module => { globalThis.__WEAPON_LIGHTING__ = module; return true; })`)
  const skinModulePath = `/@fs/${path.resolve('tests/weapon-skin-browser-cases.js').replaceAll('\\', '/')}`
  await evaluate(`import(${JSON.stringify(skinModulePath)}).then(module => { globalThis.__WEAPON_SKINS__ = module; return true; })`)
  report.skinEmission = await evaluate('__WEAPON_SKINS__.checkWeaponSkinEmission(__RANGE_ROOM__)')
  report.classic = await evaluate('__WEAPON_LIGHTING__.checkWeaponLighting(__RANGE_ROOM__)')
  for (const skin of ['smite', 'sakura']) {
    await evaluate(`(() => {
      const app = __RANGE_ROOM__; app.engine.resume();
      app.inspection.player.weapons.queue({ type: 'setSkin', instanceId: 'pistol', skinId: ${JSON.stringify(skin)} });
    })()`)
    await ready('pistol', skin)
    await evaluate('__RANGE_ROOM__.engine.pause()')
    await captureSkin(`classic-${skin}`, true)
  }
  await evaluate(`(() => {
    const app = __RANGE_ROOM__; app.engine.resume();
    app.inspection.player.weapons.queue({ type: 'selectSlot', slotId: 'primary' });
  })()`)
  await ready('rifle', 'tactiplay')
  await evaluate('__RANGE_ROOM__.engine.pause()')
  await captureSkin('phantom-tactiplay', false)
  report.phantom = await evaluate('__WEAPON_LIGHTING__.checkWeaponLighting(__RANGE_ROOM__)')
  report.reflectionDownloads = await evaluate(`performance.getEntriesByType('resource')
    .filter(entry => new URL(entry.name).pathname.startsWith('/lighting/range-room-reflections/v1/') && entry.name.endsWith('.bin')).length`)
  assert.equal(report.reflectionDownloads, 1)
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
