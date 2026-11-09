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
  await evaluate('__RANGE_ROOM__.inspection.setPaused(true)')
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
  await screenshot('teapot-center.png')

  // Read actual baked floor pixels under the projected teapot shadow. Only the
  // teapot's casting flag changes: all lighting, camera, geometry and AO stay fixed.
  report.shadow = await evaluate(`(async () => {
    const app = __RANGE_ROOM__, { light } = app.inspection.shadows;
    const pot = app.inspection.teapot.mesh.position;
    const point = pot.clone().sub(light.position);
    point.multiplyScalar((light.position.y - 9.0625) / (light.position.y - pot.y)).add(light.position).project(app.camera);
    const x = Math.round((point.x + 1) * 640), y = Math.round((1 - point.y) * 360);
    const pixels = [];
    for (let dy = -24; dy <= 24; dy += 12) for (let dx = -48; dx <= 48; dx += 12) {
      const px = x + dx, py = y + dy;
      if (px < 0 || px >= 1280 || py < 0 || py >= 720) continue;
      const hit = app.pickPixel(px, py);
      if (['lightmap', 'baked-appearance'].includes(hit?.mode)) pixels.push({ x: px, y: py, mode: hit.mode });
    }
    const values = [];
    for (const pixel of pixels) values.push(await app.render.readLinearPixel(pixel.x, pixel.y));
    globalThis.__SHADOW_SAMPLES__ = { pixels, values };
    app.inspection.teapot.mesh.castShadow = false;
    return { center: [x, y], samples: pixels.length };
  })()`)
  await frames(4)
  report.shadow.delta = await evaluate(`(async () => {
    const { pixels, values } = __SHADOW_SAMPLES__; let delta = 0;
    for (let i = 0; i < pixels.length; i++) {
      const pixel = pixels[i];
      const next = await __RANGE_ROOM__.render.readLinearPixel(pixel.x, pixel.y);
      for (let c = 0; c < 3; c++) delta = Math.max(delta, next[c] - values[i][c]);
    }
    delete globalThis.__SHADOW_SAMPLES__;
    __RANGE_ROOM__.inspection.teapot.mesh.castShadow = true;
    return delta;
  })()`)
  assert.ok(report.shadow.samples > 0 && report.shadow.delta > 0.01, 'Teapot must darken baked floor pixels')

  report.animation = await evaluate(`(() => {
    const { teapot } = __RANGE_ROOM__.inspection;
    const before = teapot.snapshot(); teapot.setPaused(false); teapot.update(8); teapot.setPaused(true);
    return { before, after: teapot.snapshot() };
  })()`)
  assert.notDeepEqual(report.animation.before.position, report.animation.after.position)
  await evaluate('__RANGE_ROOM__.inspection.focusTeapot()')
  await frames(4)
  await screenshot('teapot-focus.png')

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
    shadow: report.shadow,
    flight: report.flight,
    report: path.join(output, 'report.json'),
  }, null, 2))
  session?.close()
}
