import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { openBrowser } from './browser-session.mjs'

const output = path.resolve(process.env.WEAPON_TEST_OUTPUT ?? 'D:/opencode-temp/opencode/weapons-browser')
const report = { url: process.argv[2] ?? 'http://localhost:5173/weapon-preview.html', errors: [], messages: [] }
let session
try {
  session = await openBrowser({ output, errors: report.errors, messages: report.messages })
  await session.send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 720,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await session.navigate(report.url)
  await session.evaluate(`new Promise((resolve, reject) => {
    const deadline = performance.now() + 60000;
    function check() {
      const preview = globalThis.__WEAPON_PREVIEW__;
      if (preview?.error) return reject(new Error(preview.error));
      if (preview?.ready) return resolve(true);
      if (performance.now() > deadline) return reject(new Error('Weapon preview readiness timeout'));
      requestAnimationFrame(check);
    }
    check();
  })`)
  report.checks = await session.evaluate('__WEAPON_PREVIEW__.verify()')
  for (const [weaponId, role, time] of [
    ['classic', 'idle', 0],
    ['classic', 'reloadEmpty', 0.8],
    ['phantom', 'idle', 0],
    ['phantom', 'inspect', 1.5],
  ]) {
    await session.evaluate(`__WEAPON_PREVIEW__.sample(${JSON.stringify(weaponId)}, ${JSON.stringify(role)}, ${time})`)
    const screenshot = await session.send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(output, `${weaponId}-${role}.png`), Buffer.from(screenshot.data, 'base64'))
  }
  report.disposal = await session.evaluate('__WEAPON_PREVIEW__.dispose()')
  assert.equal(report.disposal.detached, true)
  assert.ok(report.disposal.stats.every(stats => stats.actions === 0 && stats.bindings === 0))
  assert.deepEqual(report.errors, [])
  assert.ok(!report.messages.some(message => /PropertyBinding|no target node|Failed to load texture/i.test(message.text ?? '')))
  report.passed = true
}
catch (error) {
  report.passed = false
  report.failure = error.stack
  if (session) {
    report.state = await session.evaluate(`({stage:globalThis.__WEAPON_PREVIEW__?.stage, status:document.querySelector('#status')?.textContent, resources:performance.getEntriesByType('resource').map(e=>({name:e.name,duration:e.duration}))})`).catch(() => null)
    const screenshot = await session.send('Page.captureScreenshot', { format: 'png' }).catch(() => null)
    if (screenshot)
      fs.writeFileSync(path.join(output, 'failure.png'), Buffer.from(screenshot.data, 'base64'))
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
    checks: report.checks,
    disposal: report.disposal,
    report: path.join(output, 'report.json'),
  }, null, 2))
  session?.close()
}
