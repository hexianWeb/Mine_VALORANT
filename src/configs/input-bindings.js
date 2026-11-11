/**
 * 练枪房玩法键位。蹲下不用 Ctrl：浏览器无法在前进时拦截 Ctrl+W。
 * @type {import('../engine/runtime/function/input/input-system.js').InputBindings}
 */
export const inputBindings = Object.freeze({
  KeyW: 'forward',
  KeyS: 'back',
  KeyA: 'left',
  KeyD: 'right',
  ShiftLeft: 'walk',
  ShiftRight: 'walk',
  KeyC: 'crouch',
  Space: 'jump',
  KeyR: 'respawn',
})
