import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { openBrowser } from './browser-session.mjs'

const output = path.resolve(process.env.ROOM_TEST_OUTPUT ?? 'D:/opencode-temp/opencode/runtime-browser')
const project = fileURLToPath(new URL('../', import.meta.url)).replaceAll('\\', '/')
const report = { errors: [], cases: [] }
let session
try {
  session = await openBrowser({ output, errors: report.errors })
  await session.send('Emulation.setDeviceMetricsOverride', {
    width: 800,
    height: 600,
    deviceScaleFactor: 1,
    mobile: false,
  })
  for (const editor of [true, false]) {
    const url = new URL(process.argv[2] ?? 'http://localhost:5173/')
    url.searchParams.set('probes', '0')
    url.searchParams.set('editor', editor ? '1' : '0')
    await session.navigate(url.href)
    await session.evaluate(`new Promise((resolve, reject) => {
      const deadline = performance.now() + 100000;
      (function check() {
        const error = document.querySelector('.unsupported');
        if (error && !error.hidden) return reject(new Error(error.textContent));
        if (globalThis.__RANGE_ROOM__?.ready) return resolve(true);
        if (performance.now() > deadline) return reject(new Error('Room readiness timeout'));
        requestAnimationFrame(check);
      })();
    })`)
    await session.frames(5)
    report.cases.push(await session.evaluate(`(async () => {
      const fixture = await import('/@fs/${project}tests/runtime-browser-cases.js');
      return fixture.checkLevelReload(__RANGE_ROOM__, ${editor});
    })()`))
  }
  report.gpu = await session.evaluate(`(async () => {
    const fixture = await import('/@fs/${project}tests/pipeline-browser-cases.js');
    return {
      standalone: await fixture.checkStandaloneRenderSystem(),
      normals: await fixture.checkNormalPrepass(),
    };
  })()`)
  assert.deepEqual(report.errors, [])
  report.passed = true
}
catch (error) {
  report.passed = false
  report.failure = error.stack
  process.exitCode = 1
}
finally {
  session?.close()
  fs.mkdirSync(output, { recursive: true })
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
}
