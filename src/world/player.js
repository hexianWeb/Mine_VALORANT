import * as THREE from 'three/webgpu'
import { moveAABB } from '../engine/systems/physics/character-controller.js'

/** Speeds follow published Valorant values as a starting point; body size and step height fit Minecraft blocks. */
export const playerConfig = Object.freeze({
  width: 0.6,
  standHeight: 1.8,
  standEye: 1.62,
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
})

/** First-person body: yaw 0 faces -Z, position is the feet centre. */
export function createPlayer({ camera, collision, input, config = {} }) {
  const settings = {
    ...playerConfig,
    ...config,
  }
  const position = new THREE.Vector3()
  const previous = new THREE.Vector3()
  const velocity = new THREE.Vector3()
  const euler = new THREE.Euler(0, 0, 0, 'YXZ')
  const maxPitch = THREE.MathUtils.degToRad(settings.maxPitchDeg)
  const radiansPerCount = THREE.MathUtils.degToRad(settings.degreesPerCount) * settings.sensitivity
  const groundAccel = settings.runSpeed / settings.accelTime
  const jumpSpeed = Math.sqrt(2 * settings.gravity * settings.jumpHeight)
  let yaw = 0
  let pitch = 0
  let grounded = false
  let crouched = false
  let enabled = false
  let eye = settings.standEye
  let respawns = 0

  const boxAt = (feet, height) => {
    const half = settings.width / 2
    return {
      min: [feet.x - half, feet.y, feet.z - half],
      max: [feet.x + half, feet.y + height, feet.z + half],
    }
  }
  const blocked = box => collision.world.queryAABB(box).length > 0

  const api = {
    get position() { return position },
    get velocity() { return velocity },
    get grounded() { return grounded },
    get crouched() { return crouched },
    get yaw() { return yaw },
    get pitch() { return pitch },
    get enabled() { return enabled },
    get respawns() { return respawns },
    setEnabled(value) {
      enabled = !!value
    },
    teleport(feet, newYaw, newPitch = 0) {
      position.fromArray(feet)
      previous.copy(position)
      velocity.set(0, 0, 0)
      yaw = newYaw
      pitch = THREE.MathUtils.clamp(newPitch, -maxPitch, maxPitch)
      grounded = false
      crouched = false
      eye = settings.standEye
    },
    respawn() {
      api.teleport(collision.spawn.position, collision.spawn.yaw)
      respawns++
    },
    /** Feet go `standEye` below the camera; a blocked pose falls back to the spawn. */
    placeAtCamera() {
      euler.setFromQuaternion(camera.quaternion, 'YXZ')
      const feet = camera.position.clone()
      feet.y -= settings.standEye
      if (blocked(boxAt(feet, settings.standHeight)))
        api.respawn()
      else
        api.teleport(feet.toArray(), euler.y, euler.x)
    },
    look(dx, dy) {
      yaw -= dx * radiansPerCount
      pitch = THREE.MathUtils.clamp(pitch - dy * radiansPerCount, -maxPitch, maxPitch)
    },
    fixedUpdate(dt) {
      if (!enabled)
        return
      previous.copy(position)
      const intent = input.intent
      if (intent.crouch)
        crouched = true
      else if (crouched && !blocked(boxAt(position, settings.standHeight)))
        crouched = false

      const sin = Math.sin(yaw)
      const cos = Math.cos(yaw)
      let wishX = intent.moveX * cos - intent.moveZ * sin
      let wishZ = -intent.moveX * sin - intent.moveZ * cos
      const wishLength = Math.hypot(wishX, wishZ)
      if (wishLength > 1) {
        wishX /= wishLength
        wishZ /= wishLength
      }
      const speed = crouched
        ? settings.crouchSpeed
        : intent.walk ? settings.walkSpeed : settings.runSpeed
      if (grounded || wishLength > 0) {
        const maxChange = groundAccel * (grounded ? 1 : settings.airControl) * dt
        const changeX = wishX * speed - velocity.x
        const changeZ = wishZ * speed - velocity.z
        const change = Math.hypot(changeX, changeZ)
        const scale = change > maxChange
          ? maxChange / change
          : 1
        velocity.x += changeX * scale
        velocity.z += changeZ * scale
      }

      const jumped = input.consumeJump() && grounded
      if (jumped)
        velocity.y = jumpSpeed
      const moveY = velocity.y * dt - 0.5 * settings.gravity * dt * dt
      velocity.y = Math.max(velocity.y - settings.gravity * dt, -settings.maxFallSpeed)

      const box = boxAt(position, crouched ? settings.crouchHeight : settings.standHeight)
      const result = moveAABB(collision.world, box, [velocity.x * dt, moveY, velocity.z * dt], {
        stepHeight: settings.stepHeight,
        snapDown: grounded && !jumped
          ? settings.stepHeight
          : 0,
      })
      position.set((box.min[0] + box.max[0]) / 2, box.min[1], (box.min[2] + box.max[2]) / 2)
      if (result.hitX)
        velocity.x = 0
      if (result.hitZ)
        velocity.z = 0
      if (result.hitY || (result.grounded && velocity.y < 0))
        velocity.y = 0
      grounded = result.grounded
      if (collision.isOutOfBounds(box))
        api.respawn()
    },
    updateCamera(alpha, dt) {
      const target = crouched ? settings.crouchEye : settings.standEye
      eye += (target - eye) * (1 - Math.exp(-settings.eyeSmoothing * dt))
      camera.position.lerpVectors(previous, position, alpha)
      camera.position.y += eye
      euler.set(pitch, yaw, 0, 'YXZ')
      camera.quaternion.setFromEuler(euler)
    },
    snapshot() {
      return {
        position: position.toArray(),
        velocity: velocity.toArray(),
        grounded,
        crouched,
        yawDeg: THREE.MathUtils.radToDeg(yaw),
        pitchDeg: THREE.MathUtils.radToDeg(pitch),
        respawns,
      }
    },
  }
  api.teleport(collision.spawn.position, collision.spawn.yaw)
  return api
}
