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
  const { evaluate, send, frames, navigate } = session
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 720,
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
  await frames(10)
  report.baseline = await evaluate('__RANGE_ROOM__.snapshot().inspection')
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
  await screenshot('room-center.png')
  report.removedProp = await evaluate(`(() => {
    const app = __RANGE_ROOM__;
    return {
      object: Object.hasOwn(app.world, 'teapot'),
      diagnostic: Object.hasOwn(app.inspection, 'teapot'),
      actions: [...document.querySelectorAll('.room-inspection [data-action]')].map(button => button.dataset.action),
    };
  })()`)
  assert.equal(report.removedProp.object, false)
  assert.equal(report.removedProp.diagnostic, false)
  assert.equal(Object.hasOwn(report.baseline, 'target'), false)
  for (const action of ['focus', 'pause'])
    assert.equal(report.removedProp.actions.includes(action), false)

  // Exercise focused keyboard input deterministically, independent of GPU frame rate.
  report.flight = await evaluate(`(() => {
    const app = __RANGE_ROOM__, fly = app.inspection.fly, canvas = fly.element;
    app.engine.pause();
    const key = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true, cancelable: true }));
    const move = (keys, dt = 1 / 60, count = 60) => {
      fly.cancel(); const before = app.camera.position.clone();
      keys.forEach(code => key('keydown', code));
      for (let i = 0; i < count; i++) fly.update(dt);
      keys.forEach(code => key('keyup', code));
      return app.camera.position.distanceTo(before);
    };
    canvas.focus(); const straight = move(['KeyW']); const diagonal = move(['KeyW', 'KeyD']);
    const boosted = move(['KeyW', 'ShiftLeft']); const lowFps = move(['KeyW'], 1 / 30, 30);
    const beforeY = app.camera.position.y; move(['KeyE']); const rise = app.camera.position.y - beforeY;
    key('keydown', 'KeyW'); document.querySelector('.debug-panel button').focus();
    const beforeBlur = app.camera.position.clone(); fly.update(0.1);
    const blurDelta = app.camera.position.distanceTo(beforeBlur); key('keyup', 'KeyW');
    const uiDelta = move(['KeyW']);
    return { straight, diagonal, boosted, lowFps, rise, blurDelta, uiDelta };
  })()`)
  assert.ok(Math.abs(report.flight.straight - 6) < 1e-6)
  assert.ok(Math.abs(report.flight.diagonal - report.flight.straight) < 1e-6)
  assert.ok(Math.abs(report.flight.lowFps - report.flight.straight) < 1e-6)
  assert.ok(Math.abs(report.flight.boosted - 24) < 1e-6)
  assert.ok(Math.abs(report.flight.rise - 6) < 1e-6)
  assert.equal(report.flight.blurDelta, 0)
  assert.equal(report.flight.uiDelta, 0)

  await evaluate('__RANGE_ROOM__.inspection.resetCamera()')
  const beforeLook = await evaluate('__RANGE_ROOM__.camera.quaternion.toArray()')
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: 500,
    y: 300,
    button: 'right',
    buttons: 2,
    clickCount: 1,
  })
  await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyW', key: 'w' })
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: 560,
    y: 320,
    buttons: 2,
  })
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: 560,
    y: 320,
    button: 'right',
    buttons: 0,
    clickCount: 1,
  })
  report.pointer = await evaluate(`({ quaternion: __RANGE_ROOM__.camera.quaternion.toArray(), movementHeld: __RANGE_ROOM__.inspection.fly.keys.has('KeyW') })`)
  assert.notDeepEqual(report.pointer.quaternion, beforeLook)
  assert.ok(report.pointer.movementHeld, 'Releasing look must not cancel held movement keys')
  await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyW', key: 'w' })
  await send('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x: 560,
    y: 320,
    deltaX: 0,
    deltaY: -120,
  })
  await frames(2)
  assert.ok(await evaluate('__RANGE_ROOM__.inspection.fly.speed > 6'))

  report.switching = await evaluate(`(() => {
    const app = __RANGE_ROOM__, inspect = app.inspection;
    const before = app.camera.quaternion.clone(), position = app.camera.position.clone();
    inspect.setMode('orbit'); inspect.orbit.update();
    inspect.setMode('fly');
    const angle = before.angleTo(app.camera.quaternion), distance = position.distanceTo(app.camera.position);
    inspect.setShadows(false); const disabled = inspect.shadows.snapshot();
    inspect.setShadows(true); inspect.resetCamera(); app.engine.resume();
    return { angle, distance, disabled };
  })()`)
  assert.ok(report.switching.angle < 1e-6 && report.switching.distance < 1e-6)
  assert.equal(report.switching.disabled.enabled, false)
  await frames(4)
  await evaluate('__RANGE_ROOM__.engine.destroy()')
  assert.equal(await evaluate('document.querySelectorAll(".room-inspection").length'), 0)
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
    flight: report.flight,
    report: path.join(output, 'report.json'),
  }, null, 2))
  session?.close()
}
