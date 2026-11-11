import * as THREE from 'three/webgpu'
import { Disposer } from '../../core/disposer.js'
import { EventEmitter } from '../../core/events.js'
import { Time } from '../../core/time.js'
import { Engine } from '../../engine.js'
import { createFrameDriver } from '../../platform/frame-driver.js'
import { Size } from '../../platform/size.js'
import { ResourceManager } from '../../resource/index.js'
import { WorldManager } from '../framework/world/world-manager.js'
import { createInputSystem } from '../input/input-system.js'
import { createPhysicsSystem } from '../physics/index.js'
import { createRenderSystem } from '../render/index.js'

const defaults = {
  size: options => new Size(options),
  resources: () => new ResourceManager(),
  scene: () => new THREE.Scene(),
  camera: size => new THREE.PerspectiveCamera(50, size.aspect, 0.05, 400),
  render: createRenderSystem,
  input: createInputSystem,
  physics: createPhysicsSystem,
  world: () => new WorldManager(),
  frameDriver: createFrameDriver,
}

/**
 * 构造运行时的可选参数。系统随后只拿到窄依赖，不读取本对象。
 *
 * @typedef {object} RuntimeContextOptions
 * @property {HTMLCanvasElement} [canvas] 渲染画布。
 * @property {HTMLElement | null} [container] 尺寸监听的容器。缺省为 null。
 * @property {object} [renderConfig] 渲染配置。缺省为 `{}`。
 * @property {import('../input/input-system.js').InputBindings} [inputBindings] 玩法键位。缺省不绑定键盘动作。
 * @property {import('../../core/time.js').TimeOptions} [time] 时钟选项。由 Engine 持有时钟。
 * @property {object} [factories] 系统工厂的测试替换项。
 */

/** 每个应用一个组合根。系统只接收窄依赖，从不读取本对象。 */
export class RuntimeContext {
  state = 'idle'
  events = new EventEmitter()
  #owned = new Disposer()
  #controller = new AbortController()

  /**
   * @param {RuntimeContextOptions} [options] 画布、渲染配置、玩法键位和测试工厂。全部缺省。
   */
  constructor({ canvas, container = null, renderConfig = {}, inputBindings = {}, time, factories = {} } = {}) {
    this.options = {
      canvas,
      container,
      renderConfig,
      inputBindings,
      time,
    }
    this.factories = {
      ...defaults,
      ...factories,
    }
  }

  async initialize() {
    if (this.state !== 'idle')
      throw new Error(`[RuntimeContext] Cannot initialize in state ${this.state}`)
    this.state = 'initializing'
    const { canvas, container, renderConfig, inputBindings, time } = this.options
    const factories = this.factories
    try {
      this.size = this.#owned.add(factories.size({ container, maxPixelRatio: renderConfig.maxPixelRatio }))
      this.resources = this.#owned.add(factories.resources())
      this.scene = factories.scene()
      this.camera = factories.camera(this.size)
      this.render = this.#owned.add(await factories.render({
        canvas,
        size: this.size,
        scene: this.scene,
        camera: this.camera,
        config: renderConfig,
        signal: this.#controller.signal,
      }))
      this.#controller.signal.throwIfAborted()
      this.input = this.#owned.add(factories.input({ element: canvas, bindings: inputBindings }))
      this.physics = this.#owned.add(factories.physics())
      this.world = this.#owned.add(factories.world())
      this.engine = this.#owned.add(new Engine({
        time: new Time(time),
        frameDriver: factories.frameDriver(),
        world: this.world,
        render: this.render,
      }))
      this.engine.events.on('destroy', () => this.dispose())
      this.state = 'ready'
      return this
    }
    catch (error) {
      try {
        this.dispose()
      }
      catch (cleanupError) {
        throw new AggregateError([error, cleanupError], '[RuntimeContext] Initialization and rollback failed')
      }
      throw error
    }
  }

  start() {
    if (this.state !== 'ready')
      throw new Error('[RuntimeContext] Runtime is not ready')
    this.engine.start()
  }

  dispose() {
    if (this.state === 'disposed')
      return
    this.state = 'disposed'
    const failures = []
    try {
      this.#controller.abort()
      this.engine?.destroy()
    }
    catch (error) {
      failures.push(error)
    }
    try {
      // 应用自有的 editor 和诊断必须在关卡与渲染之前脱离。
      this.events.emit('dispose')
    }
    catch (error) {
      failures.push(error)
    }
    finally {
      // 扩展回调失败也必须完成逆序释放，再向调用者报告错误。
      this.#owned.dispose()
      this.events.clear()
    }
    if (failures.length === 1)
      throw failures[0]
    if (failures.length > 1)
      throw new AggregateError(failures, '[RuntimeContext] Shutdown observers failed')
  }
}
