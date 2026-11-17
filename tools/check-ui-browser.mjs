import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { checkArmory } from './armory-browser-cases.mjs'
import { openBrowser } from './browser-session.mjs'

const url = process.argv[2] ?? 'http://127.0.0.1:5173/?editor=0&probes=0&ao=0&aa=none'
const output = path.resolve(process.argv[3] ?? `D:/opencode-temp/opencode/ui-phase-two/${Date.now()}`)
const started = performance.now()
const errors = []
const checks = []
const browser = await openBrowser({ output, errors })
const evaluate = browser.evaluate
function state() {
  return evaluate(`(() => {
  const api = globalThis.__RANGE_ROOM__, player = api.world.player;
  return {
    engine: api.engine.state, locked: document.pointerLockElement === document.querySelector('.webgl'),
    blocked: api.runtime.input.blocked, enabled: player.enabled,
    tick: api.engine.time.fixedTick, presentationTime: api.engine.time.snapshot().presentationTime,
    position: player.position.toArray(), yaw: player.yaw, respawns: player.respawns,
    settings: player.lookSettings.read(), hud: player.readHud().weapon,
    armory: player.weapons.readArmory(),
    dialogs: [...document.querySelectorAll('dialog[open]')].map(node => node.className),
    inputMessage: document.querySelector('.input-message').textContent,
    selectionNote: document.querySelector('.settings-note').textContent,
  };
})()`)
}
function waitReady() {
  return evaluate(`new Promise((resolve, reject) => {
  const start = performance.now();
  function check() {
    const api = globalThis.__RANGE_ROOM__;
    if (api?.ready && api.world.player?.weapons.snapshot().phase === 'Ready') return resolve(true);
    if (performance.now() - start > 90000) return reject(new Error(document.querySelector('.unsupported')?.textContent || 'Application readiness timeout'));
    setTimeout(check, 50);
  }
  check();
})`)
}
async function press(code, keyCode, modifiers = 0) {
  await browser.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: code,
    code,
    windowsVirtualKeyCode: keyCode,
    modifiers,
    ...(code === 'Enter'
      ? { text: '\r', unmodifiedText: '\r' }
      : {}),
  })
  await browser.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: code,
    code,
    windowsVirtualKeyCode: keyCode,
    modifiers,
  })
}
async function click(selector) {
  const point = await evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node || node.hidden) throw new Error('Missing/hidden click target: ' + ${JSON.stringify(selector)});
    node.scrollIntoView({ block: 'center' });
    const rect = node.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`)
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
  await browser.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    button: 'left',
    clickCount: 1,
    ...point,
  })
  await browser.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    button: 'left',
    clickCount: 1,
    ...point,
  })
}
async function screenshot(name) {
  const image = await browser.send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(output, name), Buffer.from(image.data, 'base64'))
}
const record = (name, details = {}) => checks.push({ name, ...details })
try {
  await browser.send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await browser.navigate(url)
  await browser.send('Page.bringToFront')
  await waitReady()
  await browser.frames(12)
  let current = await state()
  const initialShots = await evaluate('globalThis.__RANGE_ROOM__.world.player.weapons.snapshot().lastShot')
  assert.equal(initialShots, null)
  assert.equal(current.settings.sensitivity, 0.4)
  if (current.engine === 'paused')
    await click('[data-continue]')
  else
    await click('.capture-hint')
  await browser.frames(4)
  current = await state()
  assert.equal(current.locked, true, JSON.stringify(current))
  assert.equal(current.blocked, false)
  assert.equal(current.hud.weapon.magazine, 12)
  record('trusted capture click does not fire', { actualPointerLock: true })

  await press('F3', 114)
  await browser.frames(12)
  current = await state()
  assert.equal(current.engine, 'running')
  assert.equal(current.enabled, true)
  assert.equal(current.blocked, true)
  assert.equal(current.locked, false)
  assert.deepEqual(current.dialogs, ['settings-dialog'])
  assert.match(current.selectionNote, /开始.*方框/)
  const menuStart = current
  for (const [code, keyCode] of [
    ['KeyW', 87],
    ['KeyR', 82],
    ['Home', 36],
    ['Digit1', 49],
  ])
    await press(code, keyCode)
  await browser.frames(12)
  current = await state()
  assert.ok(current.tick > menuStart.tick)
  assert.deepEqual(current.position, menuStart.position)
  assert.equal(current.yaw, menuStart.yaw)
  assert.equal(current.hud.weapon.magazine, 12)
  record('F3 preserves simulation and player lifecycle while isolating gameplay input')

  await click('[data-step="0.1"]')
  await browser.frames(4)
  await click('[data-step="0.01"]')
  await browser.frames(4)
  current = await state()
  assert.equal(current.settings.sensitivity, 0.51)
  assert.equal(await evaluate('localStorage.getItem("mc-valorant.mouse-sensitivity.v1")'), '0.51')
  assert.equal(current.hud.weapon.magazine, 12)
  await evaluate(`(() => {
    const input = document.querySelector('[name="sensitivity"]');
    input.value = '100'; input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`)
  assert.equal((await state()).settings.sensitivity, 0.51)
  assert.equal(await evaluate('document.querySelector(\'[name="sensitivity"]\').getAttribute("aria-invalid")'), 'true')
  await click('[data-step="-0.01"]')
  await click('[data-step="0.01"]')
  await browser.frames(4)
  record('fine/coarse sensitivity commits, persists, and rejects invalid numeric input')
  await screenshot('settings.png')

  await click('[data-crosshair-settings]')
  assert.deepEqual((await state()).dialogs, ['settings-dialog', 'crosshair-dialog'])
  await evaluate('document.querySelector("#crosshair-code").focus()')
  await browser.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    code: 'KeyB',
    key: 'b',
    text: 'b',
    windowsVirtualKeyCode: 66,
  })
  await browser.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    code: 'KeyB',
    key: 'b',
    windowsVirtualKeyCode: 66,
  })
  assert.equal(await evaluate('document.querySelector("#crosshair-code").value.endsWith("b")'), true)
  for (let index = 0; index < 14; index++) {
    await press('Tab', 9)
    assert.equal(await evaluate('document.querySelector(".crosshair-dialog").contains(document.activeElement)'), true)
  }
  await evaluate(`(() => {
    const input = document.querySelector('#crosshair-code');
    input.value = 'not-a-code'; input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  assert.equal(await evaluate('document.querySelector(\'.crosshair-dialog button[type="submit"]\').disabled'), true)
  await evaluate(`(() => {
    const input = document.querySelector('#crosshair-code');
    input.value = '0;P;c;0;h;0;0l;3;0t;2;0o;1;0a;1;0f;0;1b;0';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  assert.equal(await evaluate('document.querySelector(\'.crosshair-dialog button[type="submit"]\').disabled'), false)
  await click('.crosshair-dialog button[type="submit"]')
  await browser.frames(2)
  assert.deepEqual((await state()).dialogs, ['settings-dialog'])
  assert.equal(await evaluate('document.activeElement.hasAttribute("data-crosshair-settings")'), true)
  assert.equal((await state()).hud.weapon.magazine, 12)
  record('native focus containment, crosshair preview/import, nested close and focus restoration')

  await press('Escape', 27)
  await browser.frames(4)
  current = await state()
  assert.deepEqual(current.dialogs, [])
  assert.equal(current.engine, 'running', 'closing top modal must not pause')
  if (!current.locked) {
    await browser.frames(70) // Browser escape-unlock cooldown; not an app timer.
    await click('.capture-hint')
    await browser.frames(4)
  }
  assert.equal((await state()).locked, true)
  await press('Escape', 27)
  await browser.frames(4)
  const paused = await state()
  assert.equal(paused.engine, 'paused')
  assert.equal(paused.blocked, true)
  assert.equal(typeof paused.presentationTime, 'number')
  await browser.frames(12)
  current = await state()
  assert.equal(current.tick, paused.tick)
  assert.equal(current.presentationTime, paused.presentationTime)
  record('first Esc closes modal; later Esc pauses and freezes fixed/presentation clocks')

  await evaluate(`(() => {
    const canvas = document.querySelector('.webgl');
    globalThis.__uiOriginalLock = canvas.requestPointerLock;
    canvas.requestPointerLock = () => Promise.reject(new DOMException('Fixture capture denial', 'NotAllowedError'));
  })()`)
  await click('[data-continue]')
  await browser.frames(4)
  current = await state()
  assert.equal(current.engine, 'paused')
  assert.match(current.inputMessage, /未能捕获/)
  const respawns = current.respawns
  await evaluate('globalThis.__RANGE_ROOM__.inspection.resetCamera()')
  assert.equal((await state()).respawns, respawns, 'explicit tool commands still wait for fixed simulation')
  await evaluate('document.querySelector(".webgl").requestPointerLock = globalThis.__uiOriginalLock')
  await browser.frames(70)
  await click('[data-continue]')
  await browser.frames(4)
  current = await state()
  assert.equal(current.engine, 'running', JSON.stringify(current))
  await waitReady()
  current = await state()
  assert.equal(current.locked, true)
  assert.equal(current.hud.weapon.magazine, 12)
  assert.equal(current.respawns, respawns + 1)
  record('capture failure stays paused; Continue does not fire and preserves explicit queued tool commands')

  // Real browser backgrounding, not a synthetic visibilitychange event.
  const originalTarget = (await browser.send('Target.getTargetInfo')).targetInfo.targetId
  const other = await browser.send('Target.createTarget', { url: 'about:blank' })
  await browser.send('Target.activateTarget', { targetId: other.targetId })
  const hidden = await evaluate('document.hidden')
  assert.equal(hidden, true, 'browser must actually background the tested page')
  assert.equal((await state()).engine, 'paused')
  await browser.send('Target.activateTarget', { targetId: originalTarget })
  await browser.send('Page.bringToFront')
  await browser.frames(4)
  assert.equal((await state()).engine, 'paused', 'focus return is not Continue')
  await browser.send('Target.closeTarget', { targetId: other.targetId })
  await browser.frames(70)
  await click('[data-continue]')
  await browser.frames(6)
  assert.equal((await state()).locked, true)
  record('actual background/focus return preserves pause until explicit recapture')

  await browser.frames(20)
  const writes = await evaluate(`new Promise(resolve => {
    let records = 0;
    const observer = new MutationObserver(changes => { records += changes.length; });
    observer.observe(document.querySelector('.weapon-readout'), { subtree: true, childList: true, characterData: true, attributes: true });
    observer.observe(document.querySelector('.range-status'), { subtree: true, childList: true, characterData: true, attributes: true });
    let frames = 0;
    function check() { if (++frames < 20) return requestAnimationFrame(check); observer.disconnect(); resolve(records); }
    requestAnimationFrame(check);
  })`)
  assert.equal(writes, 0)
  record('stationary weapon/status HUD performs zero repeated DOM writes', { frames: 20, mutationRecords: writes })
  await checkArmory({
    browser,
    press,
    click,
    screenshot,
    record,
    quick: process.env.ARMORY_QUICK === '1',
  })

  await browser.navigate(url)
  await browser.send('Page.bringToFront')
  await waitReady()
  await browser.frames(6)
  assert.equal((await state()).settings.sensitivity, 0.51)
  assert.equal(await evaluate('document.querySelectorAll(".app-ui").length'), 1)
  record('reload restores sensitivity with exactly one UI host')
  await screenshot('hud.png')

  await evaluate(`(async () => {
    const { runtime, world: level } = globalThis.__RANGE_ROOM__;
    globalThis.__uiReload = { runtime, config: level.settings, Level: level.constructor };
    await runtime.world.unloadLevel();
  })()`)
  assert.equal(await evaluate('document.querySelectorAll(".app-ui, .settings-dialog, .crosshair-dialog").length'), 0)
  await press('F3', 114)
  assert.equal(await evaluate('document.querySelectorAll("dialog[open]").length'), 0)
  await evaluate(`(async () => {
    const { runtime, config, Level } = globalThis.__uiReload;
    await runtime.world.loadLevel(() => new Level({
      scene: runtime.scene, camera: runtime.camera, resources: runtime.resources,
      input: runtime.input, physics: runtime.physics, render: runtime.render,
      audio: runtime.audio, particles: runtime.particles, config,
    }));
  })()`)
  await waitReady()
  await press('F3', 114)
  await browser.frames(3)
  assert.equal(await evaluate('document.querySelectorAll(".app-ui").length'), 1)
  assert.deepEqual((await state()).dialogs, ['settings-dialog'])
  record('unload detaches UI/listeners; remount hotkey fires once')
  if (new URL(url).searchParams.get('editor') !== '0') {
    await press('Escape', 27)
    await press('KeyB', 66)
    assert.deepEqual((await state()).dialogs, ['weapon-shop'])
    const oldScope = await evaluate('globalThis.__RANGE_ROOM__.world.player.weapons.readArmory().scopeId')
    await evaluate('globalThis.__RANGE_ROOM__.inspection.setMode("fly")')
    current = await state()
    assert.equal(current.enabled, false)
    assert.deepEqual(current.dialogs, [])
    assert.equal(await evaluate('document.querySelector(".range-status").hidden'), true)
    assert.equal(await evaluate('globalThis.__RANGE_ROOM__.runtime.input.enabled'), false)
    assert.notEqual(await evaluate('globalThis.__RANGE_ROOM__.world.player.weapons.readArmory().scopeId'), oldScope)
    assert.equal(await evaluate(`globalThis.__RANGE_ROOM__.world.player.weapons.requestArmorySelection({scopeId:${JSON.stringify(oldScope)},requestId:100,slotId:'primary'}).accepted`), false)
    await evaluate('globalThis.__RANGE_ROOM__.inspection.setMode("player")')
    await waitReady()
    await press('F3', 114)
    await browser.frames(4)
    assert.equal((await state()).engine, 'running')
    assert.deepEqual((await state()).dialogs, ['settings-dialog'])
    record('Editor handoff closes shop, invalidates old selection scope and disables player; menus remain a separate input path')
  }
  assert.deepEqual(errors, [])
}
catch (error) {
  await screenshot('failure.png').catch(() => {})
  checks.push({
    failure: String(error.stack ?? error),
    state: await state().catch(() => null),
  })
  throw error
}
finally {
  const report = {
    url,
    checks,
    errors,
    messages: browser.messages.filter(message => message.type !== 'debug').map(({ type, text, url, error }) => ({
      type,
      text,
      url,
      error,
    })),
    elapsedMs: Math.round(performance.now() - started),
  }
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  browser.close()
  console.log(JSON.stringify({
    output,
    checks: checks.length,
    errors,
    elapsedMs: report.elapsedMs,
  }))
}
