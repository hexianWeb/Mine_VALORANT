import { Disposer } from '../runtime/core/disposer.js'
import { createCollisionDebug } from '../runtime/function/render/debugdraw/collision-debug.js'
import { createDebugPanel } from './panels/render-panel.js'

/** 当前关卡的渲染调试面板和碰撞辅助线。 */
export function createEditor({ scene, render, panelContainer, lightingMode, probes, collisionBoxes }) {
  const owned = new Disposer()
  try {
    const collisionDebug = collisionBoxes
      ? owned.add(createCollisionDebug(collisionBoxes))
      : null
    if (collisionDebug)
      scene.add(collisionDebug.root)
    const panel = panelContainer
      ? owned.add(createDebugPanel(render, panelContainer, lightingMode, probes))
      : null
    return {
      collisionDebug,
      panel,
      dispose: () => owned.dispose(),
    }
  }
  catch (error) {
    owned.dispose()
    throw error
  }
}
