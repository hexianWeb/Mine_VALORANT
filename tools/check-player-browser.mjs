import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { openBrowser } from './browser-session.mjs'

const output = path.resolve(process.env.ROOM_TEST_OUTPUT ?? 'D:/opencode-temp/opencode/player-browser')
const report = { url: process.argv[2] ?? 'http://localhost:5173/', errors: [], messages: [] }
const target = new URL(report.url)
target.searchParams.set('probes', '0')
report.url = target.href
let session
try {
  session = await openBrowser({ output, errors: report.errors, messages: report.messages })
  const { evaluate, send, frames, navigate } = session
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false })
  const screenshot = async (name) => {
    const image = await send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(output, name), Buffer.from(image.data, 'base64'))
  }
  await navigate(report.url)
  await evaluate(`new Promise((resolve, reject) => {
    const deadline = performance.now() + 100000;
    (function check() {
      const error = document.querySelector('.unsupported');
      if (error && !error.hidden) return reject(new Error(error.textContent));
      if (globalThis.__RANGE_ROOM__?.ready) return resolve(true);
      if (performance.now() > deadline) return reject(new Error('Room readiness timeout'));
      requestAnimationFrame(check);
    })();
  })`)
  await frames(60)

  report.spawn = await evaluate('__RANGE_ROOM__.snapshot().player')
  assert.equal(report.spawn.mode, 'player')
  assert.equal(report.spawn.grounded, true)
  assert.ok(Math.abs(report.spawn.position[1] - 9) < 0.01, `spawn feet ${report.spawn.position[1]}`)
  await screenshot('player-spawn.png')

  await evaluate(`(() => {
    globalThis.__PLAYER_KEY__ = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true, cancelable: true }));
    globalThis.__PLAYER_HOLD__ = (code, ms) => new Promise(resolve => {
      __PLAYER_KEY__('keydown', code);
      setTimeout(() => { __PLAYER_KEY__('keyup', code); resolve(true) }, ms);
    });
    document.querySelector('.webgl').focus();
    return true;
  })()`)

  report.wall = await evaluate(`(async () => {
    const { player, collision } = __RANGE_ROOM__.inspection;
    const wall = collision.world.boxes.find(box => box.name === 'COL_Practice_Wall_East_013');
    player.teleport([20, 9, -4], -Math.PI / 2);
    document.querySelector('.webgl').focus();
    const samples = [];
    const timer = setInterval(() => samples.push(__RANGE_ROOM__.snapshot().player.stepMs), 50);
    await __PLAYER_HOLD__('KeyW', 2000);
    clearInterval(timer);
    samples.sort((a, b) => a - b);
    return { wallMinX: wall.min[0], position: player.position.toArray(), grounded: player.grounded, stepMsMedian: samples[samples.length >> 1] };
  })()`)
  assert.ok(report.wall.position[0] <= report.wall.wallMinX - 0.3 + 1e-3, `walked through the wall: ${report.wall.position[0]}`)
  assert.ok(report.wall.position[0] >= report.wall.wallMinX - 0.3 - 0.05, `did not reach the wall: ${report.wall.position[0]}`)
  assert.ok(Math.abs(report.wall.position[2] + 4) < 0.05, 'stayed on its lane')
  assert.ok(report.wall.stepMsMedian < 0.2, `physics step ${report.wall.stepMsMedian} ms`)
  await screenshot('player-wall.png')

  report.jump = await evaluate(`(async () => {
    const { player } = __RANGE_ROOM__.inspection;
    player.teleport([20, 9, -4], 0);
    await new Promise(resolve => setTimeout(resolve, 300));
    const floor = player.position.y;
    document.querySelector('.webgl').focus();
    __PLAYER_KEY__('keydown', 'Space'); __PLAYER_KEY__('keyup', 'Space');
    let apex = floor;
    const end = performance.now() + 1200;
    while (performance.now() < end) { apex = Math.max(apex, player.position.y); await new Promise(requestAnimationFrame); }
    return { floor, apex, grounded: player.grounded };
  })()`)
  assert.ok(Math.abs(report.jump.apex - report.jump.floor - 1.1) < 0.05, `jump height ${report.jump.apex - report.jump.floor}`)
  assert.equal(report.jump.grounded, true)

  report.underFloor = await evaluate(`(async () => {
    const { player, collision } = __RANGE_ROOM__.inspection;
    const spawn = collision.spawn.position;
    const floor = collision.floors.find(box => box.min[0] <= spawn[0] && spawn[0] <= box.max[0] && box.min[2] <= spawn[2] && spawn[2] <= box.max[2]);
    const before = player.respawns;
    player.position.set(spawn[0], collision.groundHeight + 0.01, spawn[2]);
    await new Promise(resolve => setTimeout(resolve, 200));
    return { floorBottom: floor.min[1], respawned: player.respawns - before, position: player.position.toArray() };
  })()`)
  assert.ok(report.underFloor.floorBottom > 7.875, 'test pose is under the spawn floor')
  assert.equal(report.underFloor.respawned, 1)
  assert.ok(Math.abs(report.underFloor.position[1] - 9) < 0.01, 'back on the spawn floor')

  report.modes = await evaluate(`(async () => {
    const app = __RANGE_ROOM__;
    const canvas = document.querySelector('.webgl');
    canvas.focus();
    canvas.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyV', bubbles: true }));
    const fly = app.snapshot().inspection.cameraMode;
    canvas.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyV', bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 300));
    return { fly, player: app.snapshot().inspection.cameraMode, grounded: app.inspection.player.grounded };
  })()`)
  assert.deepEqual(report.modes, { fly: 'fly', player: 'player', grounded: true })

  await evaluate('document.querySelector(\'.room-inspection [data-action="collision"]\').click()')
  await frames(10)
  report.debug = await evaluate('({ visible: __RANGE_ROOM__.snapshot().player.collisionDebug, label: document.querySelector(\'.room-inspection [data-action="collision"]\').textContent })')
  assert.deepEqual(report.debug, { visible: true, label: '碰撞线框：开' })
  await screenshot('player-collision-debug.png')
  await evaluate('__RANGE_ROOM__.inspection.setCollisionDebug(false)')

  await evaluate('__RANGE_ROOM__.engine.destroy()')
  assert.equal(report.errors.length, 0, 'no page errors')
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
  console.log(JSON.stringify({ passed: report.passed, failure: report.failure, errors: report.errors, spawn: report.spawn, wall: report.wall, jump: report.jump, underFloor: report.underFloor, report: path.join(output, 'report.json') }, null, 2))
  session?.close()
}
