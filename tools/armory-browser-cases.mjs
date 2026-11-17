import assert from 'node:assert/strict'

const weapons = 'globalThis.__RANGE_ROOM__.world.player.weapons'

/** Real DOM, Pointer Lock and equipment/resource pipeline cases. No renderer/gameplay mirror. */
export async function checkArmory({ browser, press, click, screenshot, record, quick = false }) {
  const evaluate = browser.evaluate
  const read = () => evaluate(`${weapons}.readArmory()`)
  const selector = slotId => `.shop-card[data-slot="${slotId}"]`
  const waitFor = (expression, label) => evaluate(`new Promise((resolve, reject) => {
    const start = performance.now();
    function check() {
      if (${expression}) return resolve(true);
      if (performance.now() - start > 45000) return reject(new Error(${JSON.stringify(label)}));
      setTimeout(check, 25);
    }
    check();
  })`)
  const ready = slotId => waitFor(`${weapons}.readArmory().request?.status === 'ready' && ${weapons}.readArmory().presentedSlotId === ${JSON.stringify(slotId)}`, `Armory selection did not become presented-ready: ${slotId}`)
  const open = async () => {
    await press('KeyB', 66)
    await browser.frames(2)
    assert.equal(await evaluate('document.querySelector(".weapon-shop").open'), true)
    assert.equal(await evaluate('globalThis.__RANGE_ROOM__.runtime.input.blocked'), true)
  }
  const select = async (slotId) => {
    await click(selector(slotId))
    await ready(slotId)
    await browser.frames(2)
    const state = await read()
    const marked = await evaluate('[...document.querySelectorAll(".shop-equipped")].filter(node => !node.hidden).map(node => node.closest("button").dataset.slot)')
    assert.deepEqual(marked, [state.presentedSlotId])
    assert.equal(await evaluate('document.querySelector(".weapon-shop").open'), true)
  }
  const ammunition = () => evaluate(`${weapons}.snapshot().inventory.weapons.map(({instanceId, magazine, reserve, shotSequence}) => ({instanceId, magazine, reserve, shotSequence}))`)
  const baselineAmmo = await ammunition()

  await open()
  let state = await read()
  assert.equal(state.catalog.length, 7)
  assert.equal(await evaluate('document.querySelectorAll(".shop-category").length'), 4)
  assert.equal(await evaluate('[...document.querySelectorAll(".shop-card img")].every(image => image.complete && image.naturalWidth > 0)'), true)
  assert.equal(await evaluate('document.querySelector(".shop-details").getBoundingClientRect().left > document.querySelector(".shop-catalog").getBoundingClientRect().left'), true)
  assert.equal(await evaluate('/99,999|购买护甲|队友请求/.test(document.querySelector(".weapon-shop").textContent)'), false)
  const beforeCandidate = state.presentedSlotId
  await evaluate('document.querySelector(\'.shop-card[data-slot="septenary"]\').focus()')
  state = await read()
  assert.equal(state.presentedSlotId, beforeCandidate)
  assert.equal(state.request, null)
  assert.equal(await evaluate('document.querySelector("[data-detail-id]").textContent'), 'ODIN')
  record('armory: four classified columns, seven local icons, independent candidate details, no fake economy')
  await screenshot('shop-desktop.png')

  await evaluate('document.querySelector(\'.shop-card[data-slot="secondary"]\').focus()')
  await press('ArrowRight', 39)
  assert.equal(await evaluate('document.activeElement.dataset.slot'), 'primary')
  await press('Enter', 13)
  await browser.frames(2)
  assert.equal((await read()).request?.slotId, 'primary', 'keyboard activation must enqueue a selection')
  await ready('primary')
  await browser.frames(2)
  assert.equal((await read()).presentedSlotId, 'primary')
  assert.equal(await evaluate('document.querySelector(".weapon-shop").open'), true)
  const seen = new Set(['secondary', 'primary'])
  record('armory: keyboard grid/Enter selects through real fixed preparation and stays open')

  // Fail a real resource request once. This is not a fabricated challenge or direct inventory edit.
  const failures = []
  const replies = []
  const failGhost = (event) => {
    const message = JSON.parse(event.data)
    if (message.method !== 'Fetch.requestPaused')
      return
    failures.push(message.params.request.url)
    replies.push(browser.send('Fetch.failRequest', { requestId: message.params.requestId, errorReason: 'Failed' }))
  }
  browser.socket.addEventListener('message', failGhost)
  await browser.send('Fetch.enable', {
    patterns: [
      { urlPattern: '*/weapons/ghost/*', requestStage: 'Request' },
    ],
  })
  try {
    await click(selector('tertiary'))
    await waitFor(`${weapons}.readArmory().request?.status === 'failed'`, 'Fixture Ghost load did not report failure')
    await Promise.all(replies)
  }
  finally {
    browser.socket.removeEventListener('message', failGhost)
    await browser.send('Fetch.disable')
  }
  state = await read()
  assert.ok(failures.length > 0, 'fixture must actually interrupt a cold weapon request')
  assert.equal(state.presentedSlotId, 'primary')
  assert.equal(await evaluate(`${weapons}.snapshot().canFire`), true)
  assert.match(await evaluate('document.querySelector(".shop-feedback").textContent'), /失败/)
  await screenshot('shop-failure.png')
  await select('tertiary')
  seen.add('tertiary')
  record('armory: real resource failure keeps old gun usable; same-card retry succeeds', { expectedNetworkFailures: failures })

  const backgroundTarget = quick ? 'secondary' : 'septenary'
  if (!quick) {
    await click(selector('quaternary'))
    await click(selector('senary'))
    await ready('senary')
    await browser.frames(10)
    assert.equal((await read()).presentedSlotId, 'senary')
    seen.add('senary')
    record('armory: rapid retargeting ends on latest Judge; late Vandal cannot overwrite it')
  }
  await click(selector(backgroundTarget))
  await press('Escape', 27)
  await browser.frames(2)
  assert.equal(await evaluate('document.querySelector(".weapon-shop").open'), false)
  assert.equal(await evaluate('globalThis.__RANGE_ROOM__.engine.state'), 'running')
  await ready(backgroundTarget)
  seen.add(backgroundTarget)
  await open()
  assert.equal((await read()).presentedSlotId, backgroundTarget)
  record('armory: Esc closes only the shop; accepted selection completes while closed')

  if (!quick) {
    for (const slotId of ['quinary', 'quaternary']) {
      await select(slotId)
      seen.add(slotId)
    }
    assert.equal(seen.size, 7)
    record('armory: all seven held slots equip through the shop without replacing inventory')
  }
  assert.deepEqual(await ammunition(), baselineAmmo, 'no card/confirm/close click may fire or refill ammunition')

  await press('Escape', 27)
  await browser.frames(2)
  await press('Escape', 27)
  await browser.frames(2)
  assert.equal(await evaluate('globalThis.__RANGE_ROOM__.engine.state'), 'paused')
  await open()
  const pausedActive = (await read()).presentedSlotId
  const pausedTarget = pausedActive === 'secondary'
    ? 'primary'
    : 'secondary'
  const tick = await evaluate('globalThis.__RANGE_ROOM__.engine.time.fixedTick')
  await click(selector(pausedTarget))
  await browser.frames(5)
  assert.equal((await read()).request.status, 'queued')
  assert.equal((await read()).presentedSlotId, pausedActive)
  assert.equal(await evaluate('globalThis.__RANGE_ROOM__.engine.time.fixedTick'), tick)
  await press('Escape', 27)
  await browser.frames(70)
  await click('[data-continue]')
  await ready(pausedTarget)
  assert.equal(await evaluate('document.pointerLockElement === document.querySelector(".webgl")'), true)
  assert.deepEqual(await ammunition(), baselineAmmo)
  record('armory: paused DOM selection waits for Continue/fixed simulation and does not fire')

  await evaluate(`${weapons}.setArmoryAccess(() => '本局进行中，请先取消挑战')`)
  await press('KeyB', 66)
  await browser.frames(2)
  assert.equal(await evaluate('document.querySelector(".weapon-shop").open'), false)
  assert.equal(await evaluate('globalThis.__RANGE_ROOM__.engine.state'), 'running')
  assert.match(await evaluate('document.querySelector(".input-message").textContent'), /本局进行中/)
  state = await read()
  assert.equal(await evaluate(`${weapons}.requestArmorySelection({scopeId:${JSON.stringify(state.scopeId)},requestId:9999,slotId:'secondary'}).accepted`), false)
  await evaluate(`${weapons}.setArmoryAccess(() => null)`)
  await open()
  await evaluate(`${weapons}.setArmoryAccess(() => '本局进行中，请先取消挑战')`)
  await browser.frames(2)
  assert.equal(await evaluate('[...document.querySelectorAll(".shop-card")].every(button => button.disabled)'), true)
  await evaluate(`${weapons}.setArmoryAccess(() => null)`)
  await browser.frames(2)
  record('armory: injected game-owned access guard rejects open/submit and updates an already-open menu; no real challenge claimed')

  const writes = await evaluate(`new Promise(resolve => {
    let mutations = 0;
    const observer = new MutationObserver(records => { mutations += records.length; });
    observer.observe(document.querySelector('.weapon-shop'), {subtree:true, childList:true, characterData:true, attributes:true});
    let count = 0;
    function next() { if (++count < 20) return requestAnimationFrame(next); observer.disconnect(); resolve(mutations); }
    requestAnimationFrame(next);
  })`)
  assert.equal(writes, 0)
  record('armory: stationary open shop reuses DOM with zero repeated writes', { frames: 20, mutationRecords: writes })

  await browser.send('Emulation.setDeviceMetricsOverride', {
    width: 640,
    height: 720,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await browser.frames(3)
  assert.equal(await evaluate('document.querySelector(".weapon-shop").scrollWidth <= document.querySelector(".weapon-shop").clientWidth + 1'), true)
  await screenshot('shop-compact.png')
  await browser.send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await browser.frames(2)
  await evaluate(`(() => {
    const owner = ${weapons};
    globalThis.__armoryRead = owner.readArmory;
    globalThis.__armoryReadCount = 0;
    owner.readArmory = function() { globalThis.__armoryReadCount++; return globalThis.__armoryRead.call(this); };
  })()`)
  await press('Escape', 27)
  await browser.frames(2)
  await evaluate('globalThis.__armoryReadCount = 0')
  await browser.frames(12)
  assert.equal(await evaluate('globalThis.__armoryReadCount'), 0)
  await evaluate(`${weapons}.readArmory = globalThis.__armoryRead`)
  assert.deepEqual(await ammunition(), baselineAmmo)
  record('armory: compact layout stays contained; closing unsubscribes continuous UI reads')
}
