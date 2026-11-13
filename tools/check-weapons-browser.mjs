import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { openBrowser } from './browser-session.mjs'
import { createWorkflowTiming } from './weapons/workflow-timing.mjs'

const output = path.resolve(process.env.WEAPON_TEST_OUTPUT ?? 'D:/opencode-temp/opencode/weapons-browser')
const args = process.argv.slice(2)
let argumentStart = 0
if (args[0] && !args[0].startsWith('--'))
  argumentStart = 1
for (let index = argumentStart; index < args.length; index++) {
  if (args[index] === '--quick')
    continue
  assert.ok(args[index] === '--weapon' && args[index + 1] && !args[index + 1].startsWith('--'), `Unknown/missing option: ${args[index]}`)
  index++
}
const quick = args.includes('--quick')
const weaponIndex = args.indexOf('--weapon')
const url = new URL(args[0] && !args[0].startsWith('--')
  ? args[0]
  : 'http://localhost:5173/weapon-preview.html')
const weapon = weaponIndex === -1
  ? url.searchParams.get('weapon') ?? 'classic'
  : args[weaponIndex + 1]
assert.ok(['classic', 'phantom'].includes(weapon), 'Pass --weapon classic or phantom')
assert.ok(quick || !url.searchParams.has('candidate'), 'Candidate smoke checks require --quick')
assert.ok(quick || weaponIndex === -1, '--weapon requires --quick; omit both flags for the full regression')
if (quick)
  url.searchParams.set('weapon', weapon)
const report = {
  url: url.href,
  profile: quick ? 'preview' : 'regression',
  errors: [],
  messages: [],
}
if (quick)
  report.publishable = false
const timing = createWorkflowTiming()
let session
try {
  session = await timing.measure('browser-start', () => openBrowser({ output, errors: report.errors, messages: report.messages }))
  await session.send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 720,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await timing.measure('page-load', () => session.navigate(report.url))
  await timing.measure('weapon-ready', () => session.evaluate(`new Promise((resolve, reject) => {
    const deadline = performance.now() + 60000;
    function check() {
      const preview = globalThis.__WEAPON_PREVIEW__;
      if (preview?.error) return reject(new Error(preview.error));
      if (preview?.ready) return resolve(true);
      if (performance.now() > deadline) return reject(new Error('Weapon preview readiness timeout'));
      requestAnimationFrame(check);
    }
    check();
  })`))
  const verifyOptions = quick
    ? {
        weapons: [weapon],
        quick: true,
      }
    : {}
  report.checks = await timing.measure('action-checks', () => session.evaluate(`__WEAPON_PREVIEW__.verify(${JSON.stringify(verifyOptions)})`))
  const samples = quick
    ? [
        [weapon, 'idle', 0],
        [weapon, 'reloadEmpty', 0.8],
        [weapon, 'inspect', 0.5],
      ]
    : [
        ['classic', 'idle', 0],
        ['classic', 'reloadEmpty', 0.8],
        ['phantom', 'idle', 0],
        ['phantom', 'inspect', 1.5],
      ]
  await timing.measure('screenshots', async () => {
    for (const [weaponId, role, time] of samples) {
      await session.evaluate(`__WEAPON_PREVIEW__.sample(${JSON.stringify(weaponId)}, ${JSON.stringify(role)}, ${time})`)
      const screenshot = await session.send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.join(output, `${weaponId}-${role}.png`), Buffer.from(screenshot.data, 'base64'))
    }
  })
  report.disposal = await timing.measure('dispose', () => session.evaluate('__WEAPON_PREVIEW__.dispose()'))
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
  report.timings = timing.snapshot()
  fs.mkdirSync(output, { recursive: true })
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({
    passed: report.passed,
    profile: report.profile,
    timings: report.timings,
    failure: report.failure,
    errors: report.errors,
    checks: report.checks,
    disposal: report.disposal,
    report: path.join(output, 'report.json'),
  }, null, 2))
  session?.close()
}
