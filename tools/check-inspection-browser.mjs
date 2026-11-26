import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { openBrowser } from './browser-session.mjs'

const output = path.resolve(process.env.ROOM_TEST_OUTPUT ?? 'D:/opencode-temp/opencode/room-inspection-browser')
const report = { url: process.argv[2] ?? 'http://localhost:5173/', errors: [], messages: [] }
const target = new URL(report.url)
target.searchParams.set('player', '0')
report.url = target.href
let session
try {
  session = await openBrowser({ output, errors: report.errors, messages: report.messages })
  const { evaluate, send, frames, navigate, click, key } = session
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 720,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await navigate(report.url)
  await send('Page.bringToFront')
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
  await frames(10)
  report.baseline = await evaluate('__RANGE_ROOM__.snapshot().inspection')
  assert.equal(report.baseline.cameraMode, 'static')
  report.referenceCamera = await evaluate(`(() => {
    const { camera, room } = __RANGE_ROOM__;
    return { position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), reference: room.manifest.camera };
  })()`)
  assert.deepEqual(report.referenceCamera.position, report.referenceCamera.reference.position)
  assert.deepEqual(report.referenceCamera.quaternion, report.referenceCamera.reference.quaternion)
  assert.ok(report.baseline.shadows.mapReady)
  assert.ok(report.baseline.shadows.bakedMaterials > 0)
  const screenshot = async (name) => {
    const image = await send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(output, name), Buffer.from(image.data, 'base64'))
  }
  assert.equal(await evaluate('!!document.querySelector(".room-inspection")'), false)
  await evaluate('document.querySelector(".webgl").focus()')
  await key('KeyV', 'v', 86)
  await frames(2)
  assert.equal(await evaluate('__RANGE_ROOM__.snapshot().inspection.cameraMode'), 'static')

  const panelSize = () => evaluate(`(() => {
    const panel = document.querySelector('.debug-panel');
    const details = panel.querySelector('details');
    return { open: details.open, width: panel.offsetWidth, height: panel.offsetHeight, headingHeight: details.querySelector('summary').offsetHeight };
  })()`)
  report.panel = { collapsed: await panelSize() }
  assert.equal(report.panel.collapsed.open, false)
  assert.equal(report.panel.collapsed.height, report.panel.collapsed.headingHeight)
  await screenshot('room-center.png')

  await click('.debug-panel summary')
  report.panel.expanded = await panelSize()
  assert.equal(report.panel.expanded.open, true)
  assert.ok(report.panel.expanded.width > report.panel.collapsed.width)
  assert.ok(report.panel.expanded.height > report.panel.collapsed.height)
  const switchTarget = await evaluate('new URL(document.querySelector(".debug-lighting a").href).searchParams.get("lighting")')
  assert.equal(switchTarget, target.searchParams.get('lighting') === 'appearance'
    ? 'lightmap'
    : 'appearance')
  report.panel.aoToggle = await evaluate(`(() => {
    const { render } = __RANGE_ROOM__;
    const row = [...document.querySelectorAll('.debug-panel .tp-lblv')].find(row => row.querySelector('.tp-lblv_l').textContent === '启用 AO');
    const checkbox = row.querySelector('input[type=checkbox]');
    const before = render.getDebugState().ao;
    checkbox.click();
    const after = render.getDebugState().ao;
    checkbox.click();
    return { before, after };
  })()`)
  assert.notEqual(report.panel.aoToggle.before, report.panel.aoToggle.after)
  await screenshot('debug-expanded.png')
  await evaluate('document.querySelector(".debug-panel summary").focus()')
  await key('Enter', 'Enter', 13)
  assert.deepEqual(await panelSize(), report.panel.collapsed)

  const shadowsEnabled = await evaluate(`(() => {
    const { inspection } = __RANGE_ROOM__;
    inspection.setShadows(false);
    const { enabled } = inspection.shadows.snapshot();
    inspection.setShadows(true);
    return enabled;
  })()`)
  assert.equal(shadowsEnabled, false)
  await evaluate('__RANGE_ROOM__.engine.destroy()')
  assert.equal(await evaluate('!!document.querySelector(".debug-panel details")'), false)
  assert.equal(await evaluate('!!globalThis.__RANGE_ROOM__'), false)
  assert.deepEqual(report.errors, [])
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
    failure: report.failure,
    errors: report.errors,
    shadows: report.baseline?.shadows,
    panel: report.panel,
    report: path.join(output, 'report.json'),
  }, null, 2))
  session?.close()
}
