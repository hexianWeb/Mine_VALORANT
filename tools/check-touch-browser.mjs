import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { openBrowser } from './browser-session.mjs'

const url = process.argv[2] ?? 'http://127.0.0.1:5173/?probes=0&ao=0&aa=none'
const output = path.resolve(process.argv[3] ?? `D:/opencode-temp/opencode/touch-hud/${Date.now()}`)
const start = performance.now()
const browser = await openBrowser({ output })
const { send, evaluate } = browser
const touch = (type, ...touchPoints) => send('Input.dispatchTouchEvent', { type, touchPoints })
function size(width, height) {
  return send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    mobile: true,
    deviceScaleFactor: 1.5,
  })
}
function point(selector, id = 1) {
  return evaluate(`(() => {
    const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return {id: ${id}, x: r.x + r.width / 2, y: r.y + r.height / 2};
  })()`)
}
async function tap(selector) {
  await touch('touchStart', await point(selector))
  await touch('touchEnd')
}
function until(condition, timeout = 10000) {
  return evaluate(`new Promise((resolve, reject) => {
    const end = performance.now() + ${timeout};
    function check() {
      const api = globalThis.__RANGE_ROOM__, player = api?.world.player, input = api?.runtime.input;
      const hud = player?.weapons?.readHud();
      if (${condition}) return resolve(true);
      const error = document.querySelector('.unsupported:not([hidden])');
      if (error || performance.now() > end) return reject(Error(error?.textContent || ${JSON.stringify(condition)} + ' ' +
        JSON.stringify({engine:api?.engine.state, ready:api?.ready, focused:document.hasFocus(), hidden:document.hidden,
          blocked:input?.blocked, phase:player?.weapons?.snapshot().phase, hud:hud?.action})));
      setTimeout(check, 30);
    }
    check();
  })`)
}
async function checkLayout(name) {
  const obscured = await evaluate(`Array.from(document.querySelectorAll('.touch-controls button, [data-stick]')).filter(node => {
    const r = node.getBoundingClientRect();
    return r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > innerHeight ||
      !node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
  }).map(n => n.outerHTML.slice(0, 100))`)
  assert.deepEqual(obscured, [], name)
  assert.equal(await evaluate(`document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.className`), 'touch-look', `${name}: keep the crosshair clear for aiming`)
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  await writeFile(path.join(output, `${name}.png`), Buffer.from(data, 'base64'))
}
try {
  await size(844, 390)
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await browser.navigate(url)
  await send('Page.bringToFront')
  await until(`api && (api.engine.state === 'running' || api.engine.state === 'paused')`, 90000)
  // Loading a fresh target can itself background the tab. Exercise its real Continue button.
  if (await evaluate(`__RANGE_ROOM__.engine.state === 'paused'`))
    await tap('[data-continue]')
  await until(`api?.ready && hud?.weapon?.definitionId === 'classic' && player.weapons.canStartChallenge()`, 90000)
  await until(`!input.blocked && !document.querySelector('.touch-controls').hidden`)
  assert.equal(await evaluate('document.pointerLockElement === null && document.querySelector(".capture-hint").hidden'), true)
  await checkLayout('landscape')

  const stick = await point('[data-stick]')
  const fire = await point('.touch-combat [data-action="fire"]', 2)
  const [x, z, yaw] = await evaluate(`(() => { const p = __RANGE_ROOM__.world.player; return [p.position.x, p.position.z, p.yaw] })()`)
  const mag = await evaluate('__RANGE_ROOM__.world.player.weapons.readHud().weapon.magazine')
  await touch('touchStart', stick)
  await touch('touchStart', stick, fire)
  await touch('touchMove', { ...stick, y: stick.y - 24 }, { ...fire, x: fire.x - 38 })
  await until(`input.axis('moveZ') > .3 && input.axis('moveZ') < 1 && input.isDown('fire')
    && Math.hypot(player.position.x - ${x}, player.position.z - ${z}) > .1
    && Math.abs(player.yaw - ${yaw}) > .1 && hud.weapon.magazine === ${mag - 1}`)
  await touch('touchCancel')
  await until(`input.axis('moveZ') === 0 && !input.isDown('fire') && !document.querySelector('.touch-controls [data-held]')`)

  await tap('.touch-combat [data-action="reload"]')
  await until(`hud.weapon.magazine === ${mag} && player.weapons.canStartChallenge()`)
  const skin = await evaluate('__RANGE_ROOM__.world.player.weapons.readHud().skinId')
  await tap('.touch-weapon-tools [data-action="cycleSkin"]')
  await until(`hud.skinId && hud.skinId !== ${JSON.stringify(skin)}`)
  await tap('.touch-weapon-tools [data-action="inspect"]')
  await until(`hud.action === 'inspect' && api.engine.state === 'running'`)
  await tap('.touch-slots [data-slot="primary"]')
  await until(`hud.weapon?.slotId === 'primary' && player.weapons.canStartChallenge()`)
  await tap('[data-toggle="aim"]')
  await until('player.readHud().aiming')
  await tap('[data-toggle="crouch"]')
  await until('player.crouched')

  const aimPad = { x: 450, y: 100, id: 4 }
  const heldYaw = await evaluate('__RANGE_ROOM__.world.player.yaw')
  await touch('touchStart', fire)
  await touch('touchStart', fire, aimPad)
  await touch('touchMove', fire, { ...aimPad, x: aimPad.x + 45 })
  await until(`input.isDown('fire') && Math.abs(player.yaw - ${heldYaw}) > .12`)
  await touch('touchEnd')

  // Three independent contacts: strafe, free look, left-hand trigger.
  const left = await point('.touch-left [data-action="fire"]', 3)
  const look = { x: 450, y: 100, id: 2 }
  const aimYaw = await evaluate('__RANGE_ROOM__.world.player.yaw')
  const beforeBurst = await evaluate('__RANGE_ROOM__.world.player.weapons.readHud().weapon.magazine')
  await touch('touchStart', stick, look, left)
  await touch('touchMove', { ...stick, x: stick.x + 30 }, { ...look, x: look.x - 24 }, left)
  await until(`input.axis('moveX') > .5 && input.isDown('fire')
    && Math.abs(player.yaw - ${aimYaw}) > .05 && hud.weapon.magazine <= ${beforeBurst - 2}`)
  await touch('touchEnd')
  await tap('[data-menu="settings"]')
  await until(`document.querySelector('.settings-dialog').open && input.blocked && !input.isDown('aim') && !input.isDown('crouch')`)
  await tap('.settings-dialog header [data-close]')
  await until('!input.blocked && !document.pointerLockElement && !player.crouched')
  await tap('[data-action="jump"]')
  await until('!player.grounded && player.velocity.y > 0')

  await tap('[data-menu="shop"]')
  await until(`document.querySelector('.weapon-shop').open && input.blocked`)
  const ghost = '.shop-card[data-weapon="ghost"]'
  await evaluate(`document.querySelector('${ghost}').scrollIntoView({block:'center'})`)
  await tap(ghost)
  await until(`hud.weapon?.definitionId === 'ghost'`)
  await tap('.shop-close')
  await until(`!input.blocked && document.querySelector('.touch-slots [data-slot="secondary"]').getAttribute('aria-pressed') === 'true'`)
  await tap('[data-menu="pause"]')
  await until(`api.engine.state === 'paused' && input.blocked`)
  await tap('[data-continue]')
  await until(`api.engine.state === 'running' && !input.blocked && !input.isDown('fire')`)
  const respawns = await evaluate('__RANGE_ROOM__.world.player.respawns')
  await tap('[data-menu="pause"]')
  await tap('.pause-shortcuts [data-action="respawn"]')
  await until(`!input.blocked && player.respawns === ${respawns + 1}`)

  await touch('touchStart', stick)
  await touch('touchMove', { ...stick, x: stick.x + 32 })
  await until(`input.axis('moveX') > .5`)
  await size(390, 844)
  await until(`innerWidth === 390 && input.axis('moveX') === 0 && !input.isDown('fire')`)
  await touch('touchEnd')
  await checkLayout('portrait')
  await size(568, 320)
  await until('innerWidth === 568')
  await checkLayout('compact-landscape')
  await size(320, 568)
  await until('innerWidth === 320')
  await checkLayout('compact-portrait')

  // A narrow mouse viewport still requires a real capture click, with no touch controls mounted.
  await send('Emulation.setTouchEmulationEnabled', { enabled: false })
  await send('Emulation.setDeviceMetricsOverride', {
    width: 760,
    height: 480,
    mobile: false,
    deviceScaleFactor: 1,
  })
  const desktop = new URL(url)
  desktop.searchParams.delete('controls')
  desktop.searchParams.set('editor', '0')
  await browser.navigate(desktop.href)
  await until('api?.ready && input.blocked', 90000)
  assert.equal(await evaluate(`document.querySelector('.touch-controls') === null`), true)
  await browser.click('.capture-hint')
  await until('input.locked && !input.blocked && !input.isDown("fire")')
  assert.deepEqual(browser.errors, [])
  console.log(JSON.stringify({
    url,
    output,
    elapsedMs: Math.round(performance.now() - start),
  }))
}
finally {
  browser.close()
}
