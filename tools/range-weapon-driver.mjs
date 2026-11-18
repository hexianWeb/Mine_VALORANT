import assert from 'node:assert/strict'

const weapons = 'globalThis.__RANGE_ROOM__?.world.player?.weapons'
const slots = ['primary', 'secondary', 'tertiary']

/** Drive the live three-slot range through trusted input. Diagnostics are read-only. */
export function createRangeWeaponDriver({ evaluate, click, key, frames, receivedPaths }) {
  const read = () => evaluate(`${weapons}.readArmory()`)
  const selector = id => `.shop-card[data-weapon="${id}"]`
  // CDP observes response URLs even when Vite imports fill the page's Resource Timing buffer.
  const packageRequests = ({ id, assets }) => {
    const modelPath = `/weapons/${assets.modelId}/${assets.assetVersion}/model.glb`
    return {
      modelPath,
      loadedModel: receivedPaths.has(modelPath),
      sounds: [...receivedPaths].filter(path => path.startsWith(`/audio/${id}/`) && path.endsWith('.ogg')).length,
    }
  }
  const waitFor = (condition, label = condition) => evaluate(`(async () => {
    const end = performance.now() + 60000;
    while (!(${condition})) {
      const error = document.querySelector('.unsupported');
      if (error && !error.hidden) throw new Error(error.textContent);
      if (performance.now() > end) throw new Error('Timeout: ' + ${JSON.stringify(label)});
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    return true;
  })()`)
  const readyInstance = id => waitFor(`(() => {
    const w = ${weapons};
    const hud = w?.readHud();
    return hud?.weapon?.instanceId === ${JSON.stringify(id)} && hud.action === 'idle' && w.snapshot().canAct;
  })()`, `Idle equipped instance: ${id}`)
  const ready = id => waitFor(`(() => {
    const { request, presentedDefinitionId } = ${weapons}.readArmory();
    if (request?.definitionId !== ${JSON.stringify(id)}) return false;
    if (['failed', 'superseded'].includes(request.status)) throw new Error(request.reason);
    return request.status === 'ready' && presentedDefinitionId === request.definitionId;
  })()`, `Presented shop selection: ${id}`)
  const open = async () => {
    await key('KeyB', 'b', 66)
    await waitFor(`document.querySelector('.weapon-shop').open && !document.pointerLockElement
      && globalThis.__RANGE_ROOM__.runtime.input.blocked`, 'Open shop with gameplay input blocked')
  }
  const select = async (id) => {
    const previousId = (await read()).request?.requestId ?? 0
    await click(selector(id))
    const { request } = await read()
    assert.equal(request?.definitionId, id)
    assert.ok(request.requestId > previousId, `Expected a new shop request for ${id}`)
    await ready(id)
    await frames(2)
    const state = await read()
    const marked = await evaluate(`[...document.querySelectorAll('.shop-equipped')]
      .filter(node => !node.hidden && node.textContent === '已装备').map(node => node.closest('button').dataset.weapon)`)
    assert.deepEqual(marked, [id])
    assert.equal(await evaluate('document.querySelector(".weapon-shop").open'), true)
    return state
  }
  const buy = async (definitionId, slotId) => {
    await open()
    const { request, catalog } = await select(definitionId)
    assert.equal(request.purchase, true)
    assert.equal(request.slotId, slotId)
    if (catalog.find(entry => entry.id === definitionId).provisional)
      assert.match(await evaluate('document.querySelector(".shop-parameter-note").textContent'), /近似值/)
    await click('.shop-close')
    await waitFor(`!document.querySelector('.weapon-shop').open && document.pointerLockElement === document.querySelector('.webgl')
      && !globalThis.__RANGE_ROOM__.runtime.input.blocked`, 'Return gameplay input to canvas')
    await readyInstance(request.instanceId)
    assert.equal(await evaluate('document.querySelector("[data-reserve]").textContent'), '∞')
    return request.instanceId
  }
  const checkSlotKeys = async (slotId, instanceId) => {
    const inventory = await evaluate(`${weapons}.snapshot().inventory`)
    assert.deepEqual(inventory.slots.map(slot => slot.id), slots)
    const held = Object.fromEntries(inventory.slots.map(slot => [slot.id, slot.instanceId]))
    assert.equal(held[slotId], instanceId)
    assert.equal(held.tertiary, 'karambit')
    const others = slots.filter(slot => slot !== slotId)
    for (const slot of [...others, slotId]) {
      const digit = slots.indexOf(slot) + 1
      await key(`Digit${digit}`, String(digit), 48 + digit)
      await readyInstance(held[slot])
    }
  }
  // Exercise a full K cycle from the actual starting skin, including the wrap back to it.
  async function* cycleSkins({ assets: { defaultSkinId, skinIds } }) {
    const start = skinIds.indexOf(defaultSkinId)
    assert.equal(await evaluate(`${weapons}.readHud().skinId`), defaultSkinId)
    for (let step = 1; step <= skinIds.length; step++) {
      const id = skinIds[(start + step) % skinIds.length]
      await key('KeyK', 'k', 75)
      await waitFor(`${weapons}.readHud().skinId === ${JSON.stringify(id)}`, `Presented skin: ${id}`)
      yield id
    }
  }
  return {
    read,
    selector,
    waitFor,
    ready,
    open,
    select,
    buy,
    readyInstance,
    checkSlotKeys,
    cycleSkins,
    packageRequests,
  }
}
