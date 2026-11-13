import { Disposer } from '../runtime/core/disposer.js'
import { createCollisionDebug } from '../runtime/function/render/debugdraw/collision-debug.js'
import { CameraControls } from './camera-controls.js'
import { createInspectionPanel } from './panels/inspection-panel.js'
import { createDebugPanel } from './panels/render-panel.js'

/** 可选工具。应用提供通往当前游戏关卡的桥。 */
export function createEditor({ canvas, scene, camera, render, panelContainer, lightingMode, probes, weaponStudy = null, collisionBoxes, bindInspection }) {
  const owned = new Disposer()
  try {
    const controls = owned.add(new CameraControls(camera, canvas))
    const collisionDebug = collisionBoxes
      ? owned.add(createCollisionDebug(collisionBoxes))
      : null
    if (collisionDebug)
      scene.add(collisionDebug.root)
    const inspection = bindInspection({ controls, collisionDebug })
    const hud = owned.add(createInspectionPanel({ canvas, inspection }))
    const panel = owned.add(createDebugPanel(render, panelContainer, lightingMode, probes, weaponStudy))
    return {
      controls,
      inspection,
      panel,
      updateInput: ({ time }) => controls.update(time.rawDelta),
      update: () => hud.update(),
      dispose: () => owned.dispose(),
    }
  }
  catch (error) {
    owned.dispose()
    throw error
  }
}
