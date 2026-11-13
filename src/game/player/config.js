/** Valorant-inspired speeds; body dimensions and steps fit Minecraft geometry. */
export const playerConfig = Object.freeze({
  width: 0.6,
  standHeight: 1.8,
  standEye: 1.7,
  crouchHeight: 1.5,
  crouchEye: 1.27,
  runSpeed: 6.75,
  walkSpeed: 3.8,
  crouchSpeed: 3.4,
  accelTime: 0.08,
  airControl: 0.15,
  gravity: 20,
  jumpHeight: 1.1,
  maxFallSpeed: 50,
  stepHeight: 0.55,
  sensitivity: 0.4,
  degreesPerCount: 0.07,
  maxPitchDeg: 89,
  eyeSmoothing: 12,
  stepSmoothingTime: 0.1, // Seconds to reach 90% of a step height change.
})
