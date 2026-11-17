import { Raycaster, Vector2 } from 'three/webgpu'

/** Legacy browser/console surface is adapted here; runtime never reads this global. */
export function installDiagnostics({ runtime, level, inspection, editor, canvas, target = globalThis }) {
  const api = {
    runtime,
    engine: runtime.engine,
    render: runtime.render,
    audio: runtime.audio,
    world: level,
    room: level.room,
    scene: runtime.scene,
    camera: runtime.camera,
    controls: editor?.controls.orbit,
    panel: editor?.panel,
    inspection: {
      ...inspection,
      fly: editor?.controls,
      orbit: editor?.controls.orbit,
      shadows: level.shadows,
      input: runtime.input,
      physics: runtime.physics,
      collision: level.collision,
    },
    get ready() {
      return runtime.state === 'ready' && level.snapshot().ready && runtime.render.snapshot().ready
    },
    snapshot() {
      const render = runtime.render.snapshot()
      const world = level.snapshot()
      const state = inspection.snapshot()
      return {
        ...render,
        ...world,
        challenge: level.readChallengeDiagnostics?.() ?? null,
        time: runtime.engine.time.snapshot(),
        audio: runtime.audio?.snapshot(),
        inspection: state,
        player: state.player,
        ready: api.ready,
        config: {
          ...render.config,
          ...world.config,
        },
      }
    },
    pickPixel(x, y) {
      const ray = new Raycaster()
      ray.setFromCamera(new Vector2(x / canvas.width * 2 - 1, 1 - y / canvas.height * 2), runtime.camera)
      const hit = ray.intersectObjects(runtime.scene.children, true)[0]
      return hit
        ? { mode: hit.object.material.userData.roomMode, name: hit.object.name }
        : null
    },
  }
  target.__RANGE_ROOM__ = api
  return () => {
    if (target.__RANGE_ROOM__ === api)
      delete target.__RANGE_ROOM__
  }
}
