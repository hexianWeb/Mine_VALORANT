// @ts-check
/**
 * Input system (TODO). Phase: 'input'.
 *
 * Contract:
 * - `update()`: read keyboard/pointer/gamepad, write an intent object (e.g. `{ moveX, moveY, jump }`)
 *   that gameplay systems read. Gameplay never touches DOM events directly.
 * - Register DOM listeners via a Disposer; release them in `dispose()`.
 */
export {}
