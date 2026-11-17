import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { openBrowser } from './browser-session.mjs'

// Regression of the room's free practice and whole-shot hit feedback.
const url = process.argv[2] ?? 'http://127.0.0.1:5173/?editor=0&probes=0&ao=0&aa=none'
const output = path.resolve(process.argv[3] ?? `D:/opencode-temp/opencode/range-phase-three/browser-${Date.now()}`)
const started = performance.now()
const errors = []
const checks = []
const browser = await openBrowser({ output, errors })
const evaluate = browser.evaluate
function wait(expression) {
  return evaluate(`new Promise((resolve, reject) => {
  const started = performance.now();
  function check() {
    if (${expression}) return resolve(true);
    if (performance.now() - started > 45000) return reject(new Error('Range regression condition timed out: ' + ${JSON.stringify(expression)}));
    setTimeout(check, 25);
  }
  check();
})`)
}
let failure = null
let failureState = null
try {
  await browser.send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await browser.navigate(url)
  await browser.send('Page.bringToFront')
  await browser.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await wait('globalThis.__RANGE_ROOM__?.ready && globalThis.__RANGE_ROOM__.world.player?.weapons?.snapshot().phase === "Ready"')
  const initial = await evaluate(`(() => {
    const world = globalThis.__RANGE_ROOM__.world;
    return { count: world.trainingBots.length, ammoPolicy: world.player.weapons.snapshot().ammoPolicy };
  })()`)
  assert.equal(initial.count, 3, 'preserve the three free-practice bots')
  assert.equal(initial.ammoPolicy, 'infinite-reserve')
  checks.push('the three free-practice bots remain available and the room supplies infinite reserve')

  await evaluate(`(() => {
    const world = globalThis.__RANGE_ROOM__.world;
    const object = world.trainingBots[1];
    // Borrow the actual attached instances; a second Vite/HMR import can have another class identity.
    globalThis.__phaseThreeBot = object.components.find(component => component.constructor.name === 'TrainingBotComponent');
    globalThis.__phaseThreeTransform = object.components.find(component => component.constructor.name === 'TransformComponent');
    if (!globalThis.__phaseThreeBot || !globalThis.__phaseThreeTransform) throw new Error('Missing attached target components');
  })()`)
  const aim = () => evaluate(`(() => {
    const player = globalThis.__RANGE_ROOM__.world.player;
    const transform = globalThis.__phaseThreeTransform;
    const p = transform.position;
    const targetY = p.y + 1.56 * transform.scale.y;
    player.teleport([p.x, p.y, p.z - 4], Math.PI, Math.atan2(targetY - p.y - player.settings.standEye, 4));
    return globalThis.__phaseThreeBot.snapshot().hitCount;
  })()`)
  let count = await aim()
  await evaluate('globalThis.__RANGE_ROOM__.world.player.weapons.queue({type:"fire"})')
  await wait(`globalThis.__phaseThreeBot.snapshot().hitCount === ${count + 1}`)
  await browser.frames(3)
  const classic = await evaluate(`(() => {
    const player = globalThis.__RANGE_ROOM__.world.player;
    return { bot: globalThis.__phaseThreeBot.snapshot(), shot: player.weapons.snapshot().lastShot };
  })()`)
  assert.equal(classic.shot.payload.weapon.definitionId, 'classic')
  assert.equal(classic.bot.lastRegion, 'chest')
  assert.ok(classic.bot.poses.authorityTime >= classic.bot.poses.presentationTime)
  checks.push('actual Classic ShotFired reaches whole-shot resolution and one delayed chest reaction')

  await evaluate(`(() => {
    const weapons = globalThis.__RANGE_ROOM__.world.player.weapons;
    return weapons.requestArmorySelection({scopeId:weapons.readArmory().scopeId, requestId:1, slotId:'senary'});
  })()`)
  await wait('globalThis.__RANGE_ROOM__.world.player.weapons.readArmory().request?.status === "ready"')
  count = await aim()
  await evaluate('globalThis.__RANGE_ROOM__.world.player.weapons.queue({type:"fire"})')
  await wait(`globalThis.__phaseThreeBot.snapshot().hitCount === ${count + 1}`)
  await browser.frames(3)
  const judge = await evaluate(`(() => {
    const weapons = globalThis.__RANGE_ROOM__.world.player.weapons;
    return { shot: weapons.snapshot().lastShot, bot: globalThis.__phaseThreeBot.snapshot(), hud: weapons.readHud() };
  })()`)
  assert.equal(judge.shot.payload.weapon.definitionId, 'judge')
  assert.equal(judge.shot.payload.pellets.length, 12)
  assert.equal(judge.bot.hitCount, count + 1)
  assert.equal(judge.hud.weapon.ammoPolicy, 'infinite-reserve')
  checks.push('actual Judge queries twelve pellets and emits one reaction, not twelve or a legacy double reaction')

  await evaluate('globalThis.__RANGE_ROOM__.engine.pause()')
  const frozen = await evaluate('globalThis.__phaseThreeBot.snapshot().poses')
  await browser.frames(8)
  assert.deepEqual(await evaluate('globalThis.__phaseThreeBot.snapshot().poses'), frozen)
  checks.push('engine pause freezes existing authority and presentation skeleton clocks')
  assert.deepEqual(errors, [])
}
catch (error) {
  failure = error.stack ?? String(error)
  failureState = await evaluate(`(() => {
    const api = globalThis.__RANGE_ROOM__;
    return {
      ready: api?.ready,
      engine: api?.engine.state,
      hidden: document.hidden,
      phase: api?.world.player?.weapons?.snapshot().phase,
      inputBlocked: api?.runtime.input.blocked,
      bot: globalThis.__phaseThreeBot?.snapshot(),
      shot: api?.world.player?.weapons?.snapshot().lastShot,
    };
  })()`).catch(() => null)
  process.exitCode = 1
}
finally {
  const report = {
    url,
    checks,
    errors,
    messages: browser.messages,
    failure,
    failureState,
    elapsedMs: Math.round(performance.now() - started),
    playableChallenge: false,
  }
  fs.writeFileSync(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  browser.close()
  console.log(JSON.stringify({
    output,
    checks: checks.length,
    errors,
    failure,
    elapsedMs: report.elapsedMs,
  }))
}
