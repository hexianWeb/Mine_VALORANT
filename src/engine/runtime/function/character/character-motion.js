/** 以脚底为中心的角色包围盒；供移动和游戏侧放置规则使用。 */
export function characterBox(feet, settings, crouched = false) {
  const half = settings.width / 2
  return {
    min: [feet.x - half, feet.y, feet.z - half],
    max: [feet.x + half, feet.y + (crouched ? settings.crouchHeight : settings.standHeight), feet.z + half],
  }
}

/** 纯运动学策略。不涉及输入设备、相机、生成或组件生命周期。 */
export function characterMotion(motor, dt) {
  const { command, state: settings, velocity, transform, physics, world, grounded } = motor
  const position = transform.position
  if (command.crouch)
    motor.crouched = true
  else if (motor.crouched && !physics.overlaps(world, characterBox(position, settings)))
    motor.crouched = false

  // 身体朝向取自权威四元数，包括非玩家控制。
  const { y, w } = transform.quaternion
  const yaw = Number.isFinite(command.headingYaw)
    ? command.headingYaw
    : 2 * Math.atan2(y, w)
  const sin = Math.sin(yaw)
  const cos = Math.cos(yaw)
  const moveX = command.moveX ?? 0
  const moveZ = command.moveZ ?? 0
  let wishX = moveX * cos - moveZ * sin
  let wishZ = -moveX * sin - moveZ * cos
  const wishLength = Math.hypot(wishX, wishZ)
  if (wishLength > 1) {
    wishX /= wishLength
    wishZ /= wishLength
  }
  const speed = motor.crouched
    ? settings.crouchSpeed
    : command.walk ? settings.walkSpeed : settings.runSpeed
  if (grounded || wishLength > 0) {
    const maxChange = settings.runSpeed / settings.accelTime * (grounded ? 1 : settings.airControl) * dt
    const changeX = wishX * speed - velocity.x
    const changeZ = wishZ * speed - velocity.z
    const change = Math.hypot(changeX, changeZ)
    const scale = change > maxChange
      ? maxChange / change
      : 1
    velocity.x += changeX * scale
    velocity.z += changeZ * scale
  }

  const jumped = command.jump && grounded
  command.jump = false
  if (jumped)
    velocity.y = Math.sqrt(2 * settings.gravity * settings.jumpHeight)
  const moveY = velocity.y * dt - 0.5 * settings.gravity * dt * dt
  velocity.y = Math.max(velocity.y - settings.gravity * dt, -settings.maxFallSpeed)
  return {
    box: characterBox(position, settings, motor.crouched),
    displacement: [velocity.x * dt, moveY, velocity.z * dt],
    options: {
      stepHeight: settings.stepHeight,
      snapDown: grounded && !jumped
        ? settings.stepHeight
        : 0,
    },
  }
}
