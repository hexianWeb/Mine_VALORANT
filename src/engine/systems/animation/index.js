// @ts-check
/**
 * Animation system (TODO). Phase: 'animation'.
 *
 * Contract:
 * - `update()`: advance AnimationMixers with `engine.time.delta` (respects pause and timeScale).
 * - GSAP tweens created here are registered on a Disposer (tween.kill() on dispose).
 * - Free mixers / kill tweens in `dispose()`.
 */
export {}
