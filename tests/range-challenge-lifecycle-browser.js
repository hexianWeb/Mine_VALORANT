/** Runs inside the loaded game page; use real resources and Level ownership throughout. */
export async function checkChallengeLifecycle({ runtime, world: previous }) {
  function check(condition, message) {
    if (!condition)
      throw new Error(`Challenge lifecycle: ${message}`)
  }
  const { scene, world, resources, engine } = runtime
  const RoomLevel = previous.constructor
  const makeLevel = () => new RoomLevel({
    scene,
    camera: runtime.camera,
    resources,
    input: runtime.input,
    physics: runtime.physics,
    render: runtime.render,
    audio: runtime.audio,
    particles: runtime.particles,
    config: previous.settings,
    fixedDelta: engine.time.fixedDelta,
    maxAnisotropy: runtime.render.renderer.getMaxAnisotropy(),
  })
  const original = previous.readChallengeDiagnostics()
  const objectCount = previous.objects.size
  const panels = scene.getObjectByName('Range world panels')
  const effects = scene.getObjectByName('Range kill effects')
  let panelDisposals = 0
  let effectDisposals = 0
  panels.getObjectByName(original.panel.bottom.name).material.map.addEventListener('dispose', () => panelDisposals++)
  effects.getObjectByProperty('isLineSegments', true).geometry.addEventListener('dispose', () => effectDisposals++)

  // Seed an accepted panel command so the unload must return live targets, not just an idle pool.
  const challenge = previous.challenge
  const { ready, revision, selection } = challenge.readControlState()
  const { fixedTick, fixedDelta, fixedElapsed } = engine.time.snapshot()
  check(ready, 'initial session cannot start')
  challenge.onShotResolved({
    sourceId: 'lifecycle-case',
    epoch: 1,
    sequence: 1,
    fixedTick,
    at: fixedElapsed,
    disposition: 'interaction',
    interactions: [
      { type: 'StartRequested', revision, selection },
    ],
    deaths: [],
  }, { fixedTick, fixedDelta, fixedElapsed })
  check(previous.readChallengeDiagnostics().hittable.length > 0, 'no live targets on entry to unload')
  await world.unloadLevel()
  previous.dispose() // Repeated shutdown must not free either resource twice.
  check(challenge.disposed && !challenge.running && !panels.parent && !effects.parent, 'old session or roots survived')
  check(panelDisposals === 1 && effectDisposals === 1, 'panel texture or effect geometry not released exactly once')
  const remaining = [...scene.children]
  function checkUnloaded(level) {
    check(!world.activeLevel && level.disposed && level.objects.size === 0, 'partially active level')
    check(!level.challenge && !level.readChallengeHud() && !level.readChallengeDiagnostics(), 'stale challenge reads')
    check(!scene.getObjectByName(panels.name) && !scene.getObjectByName(effects.name), 'orphaned presentation roots')
    check(scene.children.length === remaining.length && remaining.every(root => root.parent === scene), 'scene was not restored')
  }
  checkUnloaded(previous)

  const controller = new AbortController()
  const cancelled = makeLevel()
  const off = resources.on('progress', ({ name }) => {
    if (name === 'range-room:training-bot:model')
      controller.abort()
  })
  try {
    await world.loadLevel(() => cancelled, { signal: controller.signal })
    throw new Error('aborted load succeeded')
  }
  catch (error) {
    if (!controller.signal.aborted || error.name !== 'AbortError')
      throw error
  }
  finally { off() }
  checkUnloaded(cancelled)

  const partial = makeLevel()
  const failure = new Error('injected failure after target pool attachment')
  const add = partial.addObject.bind(partial)
  partial.addObject = (object) => {
    if (object.name === 'Range challenges')
      throw failure
    return add(object)
  }
  try {
    await world.loadLevel(() => partial)
    throw new Error('partial mount succeeded')
  }
  catch (error) {
    if (error !== failure)
      throw error
  }
  checkUnloaded(partial)

  const fresh = await world.loadLevel(makeLevel)
  const next = fresh.readChallengeDiagnostics()
  check(fresh.challenge !== challenge && fresh.readChallengeHud().status === 'idle', 'reload reused the old session')
  check(next.display === fresh.readChallengeHud() && !next.hittable.length, 'reload published stale targets or HUD')
  check(fresh.objects.size === objectCount && next.poolSize === original.poolSize, 'pool or object count changed')
  check(next.layout.legalCells === original.layout.legalCells, 'spawn layout changed on reload')
  return {
    poolSize: next.poolSize,
    legalCells: next.layout.legalCells,
    panelDisposals,
    effectDisposals,
  }
}
