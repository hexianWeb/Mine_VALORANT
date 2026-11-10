import * as THREE from 'three/webgpu'
import { Disposer } from '../../core/disposer.js'

const movementKeys = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyQ',
  'KeyE',
  'ShiftLeft',
  'ShiftRight',
])

/** Editor-style free flight: right-drag look, focused WASD/QE, Shift boost, wheel speed. */
export class FlyController {
  constructor(camera, element, { speed = 6, lookSpeed = 0.0025, boost = 4 } = {}) {
    this.camera = camera
    this.element = element
    this.speed = speed
    this.lookSpeed = lookSpeed
    this.boost = boost
    this.enabled = true
    this.keys = new Set()
    this.pointer = null
    this.euler = new THREE.Euler(0, 0, 0, 'YXZ')
    this.forward = new THREE.Vector3()
    this.right = new THREE.Vector3()
    this.movement = new THREE.Vector3()
    this.disposer = new Disposer()
    const document = element.ownerDocument
    const window = document.defaultView
    const tabIndex = element.getAttribute('tabindex')
    const cursor = element.style.cursor
    element.tabIndex = 0
    this.disposer.add(() => {
      if (tabIndex === null)
        element.removeAttribute('tabindex')
      else
        element.setAttribute('tabindex', tabIndex)
      element.style.cursor = cursor
    })
    this.disposer.listen(element, 'pointerdown', (event) => {
      if (!this.enabled)
        return
      element.focus({ preventScroll: true })
      if (event.button !== 2)
        return
      event.preventDefault()
      this.pointer = event.pointerId
      this.lastX = event.clientX
      this.lastY = event.clientY
      element.setPointerCapture(event.pointerId)
      element.style.cursor = 'grabbing'
    })
    this.disposer.listen(element, 'pointermove', (event) => {
      if (!this.enabled || this.pointer !== event.pointerId)
        return
      const dx = event.clientX - this.lastX
      const dy = event.clientY - this.lastY
      this.lastX = event.clientX
      this.lastY = event.clientY
      this.euler.setFromQuaternion(camera.quaternion, 'YXZ')
      this.euler.y -= dx * this.lookSpeed
      this.euler.x = THREE.MathUtils.clamp(this.euler.x - dy * this.lookSpeed, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01)
      this.euler.z = 0
      camera.quaternion.setFromEuler(this.euler)
    })
    this.disposer.listen(element, 'pointerup', event => event.pointerId === this.pointer && this.stopLook())
    this.disposer.listen(element, 'pointercancel', () => this.cancel())
    this.disposer.listen(element, 'lostpointercapture', () => this.stopLook())
    this.disposer.listen(element, 'contextmenu', (event) => {
      if (this.enabled)
        event.preventDefault()
    })
    this.disposer.listen(element, 'wheel', (event) => {
      if (!this.enabled)
        return
      event.preventDefault()
      this.speed = THREE.MathUtils.clamp(this.speed * Math.exp(-event.deltaY * 0.001), 0.5, 40)
    }, { passive: false })
    this.disposer.listen(window, 'keydown', (event) => {
      if (!this.enabled || document.activeElement !== element || event.ctrlKey || event.metaKey || event.altKey)
        return
      if (event.code === 'Escape') {
        this.cancel()
        element.blur()
      }
      if (movementKeys.has(event.code)) {
        event.preventDefault()
        this.keys.add(event.code)
      }
    })
    this.disposer.listen(window, 'keyup', event => this.keys.delete(event.code))
    this.disposer.listen(element, 'blur', () => this.cancel())
    this.disposer.listen(window, 'blur', () => this.cancel())
    this.disposer.listen(document, 'visibilitychange', () => this.cancel())
  }

  setEnabled(value) {
    this.enabled = !!value
    this.cancel()
  }

  cancel() {
    this.keys.clear()
    this.stopLook()
  }

  stopLook() {
    const pointer = this.pointer
    this.pointer = null
    if (pointer !== null && this.element.hasPointerCapture(pointer))
      this.element.releasePointerCapture(pointer)
    this.element.style.cursor = ''
  }

  update(delta) {
    // Check focus at consumption time too: UI handlers can intercept blur events.
    if (!this.enabled || this.element.ownerDocument.activeElement !== this.element) {
      this.cancel()
      return
    }
    if (!this.keys.size)
      return
    const key = code => Number(this.keys.has(code))
    this.camera.getWorldDirection(this.forward)
    this.right.crossVectors(this.forward, this.camera.up).normalize()
    this.movement.copy(this.forward).multiplyScalar(key('KeyW') - key('KeyS')).addScaledVector(this.right, key('KeyD') - key('KeyA')).addScaledVector(this.camera.up, key('KeyE') - key('KeyQ'))
    const boost = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')
      ? this.boost
      : 1
    this.camera.position.addScaledVector(this.movement.normalize(), this.speed * boost * THREE.MathUtils.clamp(delta, 0, 0.1))
  }

  dispose() {
    this.setEnabled(false)
    this.disposer.dispose()
  }
}
