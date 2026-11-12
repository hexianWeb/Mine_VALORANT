// @ts-check

import { createEditor } from '../engine/editor/editor.js'
import { Disposer, RuntimeContext } from '../engine/runtime/index.js'
import { RangeRoomLevel } from '../game/range-room/level.js'
import { readAppConfig } from './config.js'
import { createTeapotInspection, installDiagnostics } from './diagnostics.js'
import { mountWeaponHud } from './weapon-hud.js'

/**
 * 标准 `Navigator` 尚未包含 WebGPU 入口。浏览器不支持时没有 `gpu`。
 *
 * @typedef {Navigator & { gpu?: object }} WebGpuNavigator
 */

/**
 * `readAppConfig()` 的返回值。
 * `?editor=0` 关闭编辑器，`?player=0` 从飞行开始，`?probes=0` 关闭探针，
 * `?lighting=appearance` 改用外观清单，`?ao=0` 关闭环境光遮蔽，`?aa=none` 关闭抗锯齿，`?profile=1` 记录时间戳。
 *
 * @typedef {ReturnType<typeof readAppConfig>} AppConfig
 */

/**
 * 观察相机模式。
 * 有玩家时默认 `player`，可再切到 `fly` 或 `orbit`；无玩家但有控件时默认 `fly`；两者都没有时为 `static`。
 *
 * @typedef {'player' | 'fly' | 'orbit' | 'static'} InspectionCameraMode
 */

/**
 * 玩家快照。包含玩家自身快照的全部字段，并附加当前观察状态。
 *
 * @typedef {object} InspectionPlayerSnapshot
 * @property {InspectionCameraMode} mode 当前观察模式。
 * @property {number} boxes 碰撞盒数量。
 * @property {number} stepMs 最近一次物理步进耗时，单位毫秒。
 * @property {boolean} collisionDebug 碰撞辅助线当前是否可见。
 */

/**
 * `createInspection()` 给出的只读观察状态，供面板和诊断读取。
 *
 * @typedef {object} InspectionSnapshot
 * @property {InspectionCameraMode} cameraMode 当前观察模式。
 * @property {number} flySpeed 飞行速度。没有控件时为 0。
 * @property {object | undefined} target 茶壶快照。没有茶壶时缺省。
 * @property {object | undefined} shadows 阴影快照。没有阴影时缺省。
 * @property {InspectionPlayerSnapshot | null} player 玩家快照。关卡没有玩家时为 null。
 */

/**
 * 编辑器面板和诊断共用的关卡操作。本对象不持有场景物体，也不推进循环。
 *
 * @typedef {object} Inspection
 * @property {object | null} player 关卡玩家。没有玩家时为 null。
 * @property {ReturnType<typeof createTeapotInspection>} target 茶壶组件的观察接口。
 * @property {object | null} collisionDebug 碰撞辅助线。编辑器关闭或关卡没有碰撞盒时为 null。
 * @property {{ focus: string, pause: string, resume: string, help: { player: string, fly: string, orbit: string } }} labels 面板按钮文案和三种模式的操作说明。
 * @property {(value: InspectionCameraMode) => void} setMode 切换观察模式。
 * @property {() => void} focusTarget 把观察相机对准茶壶。
 * @property {() => void} resetCamera 玩家模式重生，否则恢复观察相机初始机位。
 * @property {(value: boolean) => void} setPaused 暂停或继续茶壶漂浮。
 * @property {(value: boolean) => void} setShadows 开关阴影。
 * @property {(value: boolean) => void} setCollisionDebug 开关碰撞辅助线。
 * @property {() => InspectionSnapshot} snapshot 读取当前观察状态。
 */

/**
 * `createApplication()` 的返回值。构造时只完成接线，调用 `initialize` 后才加载关卡并启动循环。
 *
 * @typedef {object} Application
 * @property {RuntimeContext} runtime 已构造的运行时。`initialize` 完成前状态为 `idle`。
 * @property {() => Promise<RuntimeContext>} initialize 初始化 WebGPU、加载练枪房并启动帧循环。
 * @property {() => void} dispose 关闭运行时。重复调用无效果。
 */

/**
 * 应用组装根。`main.js` 调用本函数。
 *
 * 连接关系：`RuntimeContext` 持有场景、渲染、输入、物理和帧循环；`RangeRoomLevel` 持有房间、玩家、茶壶和光照；
 * `createEditor` 持有飞行、环绕相机、面板和碰撞辅助线；`createInspection` 把关卡操作收成工具接口；
 * `installDiagnostics` 把诊断面挂到 `globalThis.__RANGE_ROOM__`。
 * runtime 不依赖练枪房，editor 也不直接调用关卡内部。
 *
 * 清理分两层。`owned` 跟随整个应用，在 runtime 发出 `dispose` 时执行，编辑器和诊断因此先于关卡与渲染器卸下。
 * `levelTools` 只跟随当前关卡：`load` 时整组替换，`unload` 时释放，且 `unload` 发生在 `Level.dispose()` 之前。
 *
 * @param {object} config 页面入口传入的节点与配置。
 * @param {HTMLCanvasElement} config.canvas 渲染画布。
 * @param {HTMLElement | null} config.status 加载提示节点。关卡就绪后隐藏。
 * @param {HTMLElement | null} config.panelContainer 调试面板容器。`options.editor` 为 false 时隐藏。
 * @param {(error: unknown) => void} [config.onError] 帧循环中的运行时错误。初始化失败仍由返回的 Promise 拒绝。
 * @param {AppConfig} [config.options] 应用配置。缺省为 `readAppConfig()`，即读取当前 URL。
 * @returns {Application} 尚未启动的应用。
 */
export function createApplication({ canvas, status, panelContainer, onError, options = readAppConfig() }) {
  const runtime = new RuntimeContext({
    canvas,
    renderConfig: options.render,
    inputBindings: options.inputBindings,
  })
  /** 跟随整个应用。登记的清理函数读取当前 `levelTools`，卸下的是最后一关的工具。 */
  const owned = new Disposer()
  /** 只跟随当前关卡。每次 `load` 替换，`unload` 时释放。 */
  let levelTools = new Disposer()
  owned.add(() => levelTools.dispose())
  runtime.events.on('dispose', () => owned.dispose())
  if (panelContainer)
    panelContainer.hidden = !options.editor

  /**
   * 关卡 `load` 之后挂上这一关的工具。
   * 先释放上一关的 `levelTools`，再换一个新的清理器。
   * 编辑器开启时创建控件，并把 `updateInput`、`update` 接到引擎的 `input` 与 `frame`；编辑器自身没有第二套循环。
   * `options.editor` 为 false 时不创建控件，观察接口以空控件建立。两种情况都会安装诊断。
   *
   * @param {RangeRoomLevel} level 刚加载完成的关卡。
   * @returns {void}
   */
  const mountLevelTools = (level) => {
    levelTools.dispose()
    levelTools = new Disposer()
    /**
     * 把编辑器控件交给观察接口。编辑器关闭时不传控件。
     *
     * @param {object} [tools] 编辑器创建的控件。缺省表示没有观察相机。
     * @param {import('../engine/editor/camera-controls.js').CameraControls | null} [tools.controls] 飞行与环绕相机。
     * @param {object | null} [tools.collisionDebug] 碰撞辅助线。
     * @returns {Inspection} 当前关卡的观察接口。
     */
    const bindInspection = ({ controls = null, collisionDebug = null } = {}) => createInspection({
      level,
      canvas,
      controls,
      collisionDebug,
      physics: runtime.physics,
      startMode: options.startMode,
    })
    const editor = options.editor
      ? levelTools.add(createEditor({
          canvas,
          scene: runtime.scene,
          camera: runtime.camera,
          render: runtime.render,
          panelContainer,
          lightingMode: level.snapshot().lightingMode,
          probes: level.probes,
          collisionBoxes: level.collision?.world.boxes,
          bindInspection,
        }))
      : null
    const inspection = editor?.inspection ?? bindInspection()
    if (level.player)
      levelTools.add(mountWeaponHud({ canvas, player: level.player, engine: runtime.engine }))
    levelTools.add(runtime.engine.events.on('pause', () => level.player?.setPaused(true)))
    levelTools.add(runtime.engine.events.on('resume', () => level.player?.setPaused(false)))
    if (editor) {
      levelTools.add(runtime.engine.events.on('input', editor.updateInput))
      levelTools.add(runtime.engine.events.on('frame', editor.update))
    }
    levelTools.add(installDiagnostics({
      runtime,
      level,
      editor,
      inspection,
      canvas,
    }))
  }

  return {
    runtime,
    /**
     * 检查 WebGPU，初始化运行时，加载练枪房，然后启动帧循环。
     *
     * 顺序是：没有 `navigator.gpu` 时抛错；`runtime.initialize()` 建立尺寸、资源、场景、相机、渲染、输入、物理、世界和引擎；
     * 订阅渲染错误以及关卡的 `load`、`unload`；加载 `RangeRoomLevel`；runtime 仍为 `ready` 时隐藏加载提示并 `runtime.start()`。
     * 探针捕获期间更新加载文案，runtime 已离开 `ready` 时不再改 DOM。
     * 加载结束时若应用已经关闭，抛出 `AbortError`，不启动循环。
     * 任一步失败都会先 `runtime.dispose()`，再把原错误抛回调用方。
     *
     * @returns {Promise<RuntimeContext>} 已启动的运行时。
     * @throws {Error} 浏览器没有 WebGPU，或运行时初始化、关卡加载失败。
     * @throws {DOMException} 加载期间应用已关闭。`name` 为 `AbortError`。
     */
    async initialize() {
      try {
        const browser = /** @type {WebGpuNavigator} */ (navigator)
        if (!browser.gpu)
          throw new Error('当前浏览器不支持 WebGPU，请使用113+版 Chrome 或 Edge。')
        await runtime.initialize()
        owned.add(runtime.engine.events.on('error', ({ error }) => onError?.(error)))
        owned.add(runtime.world.events.on('load', mountLevelTools))
        owned.add(runtime.world.events.on('unload', () => levelTools.dispose()))
        await runtime.world.loadLevel(() => new RangeRoomLevel({
          scene: runtime.scene,
          camera: runtime.camera,
          resources: runtime.resources,
          input: runtime.input,
          physics: runtime.physics,
          render: runtime.render,
          audio: runtime.audio,
          maxAnisotropy: runtime.render.renderer.getMaxAnisotropy(),
          config: options.level,
        }), {
          onProgress: (state) => {
            if (status && runtime.state === 'ready') {
              status.textContent = state.busy
                ? `正在捕获室内探针 ${Math.round(state.progress * 100)}%…`
                : '正在加载室内探针…'
            }
          },
        })
        if (runtime.state !== 'ready')
          throw new DOMException('Application was closed during loading', 'AbortError')
        if (status)
          status.hidden = true
        runtime.start()
        return runtime
      }
      catch (error) {
        runtime.dispose()
        throw error
      }
    },
    /** 关闭运行时。重复调用无效果。 */
    dispose: () => runtime.dispose(),
  }
}

/**
 * 把当前关卡已有的玩家、茶壶、阴影和碰撞调试收成 {@link Inspection}。
 * 不创建对象，也不拥有 tick。
 *
 * 初始模式：有玩家时为 `player`；无玩家但有控件时为 `fly`；两者都没有时为 `static`。
 * 有玩家才出现 `player` 模式，有控件才出现 `fly` 与 `orbit`。
 * `startMode` 为 `fly` 且存在控件时，返回前立即切到飞行。该值来自 URL `?player=0`。
 *
 * @param {object} args 当前关卡和可选的编辑器控件。
 * @param {RangeRoomLevel} args.level 已加载的练枪房。
 * @param {HTMLCanvasElement} args.canvas 接受焦点的画布。模式切换后聚焦，且不滚动页面。
 * @param {import('../engine/editor/camera-controls.js').CameraControls | null} args.controls 飞行与环绕相机。编辑器关闭时为 null。
 * @param {object | null} args.collisionDebug 碰撞辅助线。没有时为 null。
 * @param {{ lastStepMs: number }} args.physics 物理系统。快照只读取最近一步耗时。
 * @param {AppConfig['startMode']} args.startMode 初始观察模式来源。`player` 保持玩家，`fly` 在有控件时切到飞行。
 * @returns {Inspection} 面板与诊断共用的观察接口。
 */
function createInspection({ level, canvas, controls, collisionDebug, physics, startMode }) {
  const target = createTeapotInspection(level.teapot)
  /** @type {InspectionCameraMode} */
  let mode = /** @type {InspectionCameraMode} */ (level.player
    ? 'player'
    : controls ? 'fly' : 'static')
  const modes = [
    ...(level.player
      ? ['player']
      : []),
    ...(controls
      ? ['fly', 'orbit']
      : []),
  ]
  const api = {
    player: level.player,
    target,
    collisionDebug,
    labels: {
      focus: '定位茶壶 F',
      pause: '暂停漂浮',
      resume: '继续漂浮',
      help: {
        player: '点击锁定 · 左键开火 · 右键瞄准 · 1/2/滚轮切枪 · R 换弹 · T 检视 · WASD 移动 · Home 重生 · V 飞行 · Esc 释放',
        fly: '点击画面激活 · 右键拖动视角 · WASD 移动 · Q/E 降/升 · Shift 加速 · 滚轮调速 · Esc 释放',
        orbit: '左键环绕 · 右键平移 · 滚轮缩放 · F 定位茶壶 · R 恢复初始机位',
      },
    },
    /**
     * 切换观察模式。未知模式抛错；目标与当前相同时直接返回。
     * 切到 `player` 时关闭编辑器相机、启用玩家，并把玩家放到当前机位。
     * 切到 `fly` 或 `orbit` 时关闭玩家，控件使用同名模式。成功切换后聚焦画布。
     *
     * @param {InspectionCameraMode} value 目标模式。必须包含在当前可用模式中。
     * @returns {void}
     * @throws {Error} `value` 不是当前关卡可用的观察模式。
     */
    setMode(value) {
      if (!modes.includes(value))
        throw new Error(`Unknown inspection camera mode: ${value}`)
      if (mode === value)
        return
      controls?.setMode(value === 'player'
        ? 'none'
        : value)
      level.setPlayerEnabled(value === 'player')
      if (value === 'player')
        level.player.placeAtCamera()
      mode = value
      canvas.focus({ preventScroll: true })
    },
    /**
     * 把观察相机对准茶壶。没有控件或茶壶时直接返回。
     * 当前为玩家模式时先切到飞行。
     *
     * @returns {void}
     */
    focusTarget() {
      if (!controls || !target)
        return
      if (mode === 'player')
        api.setMode('fly')
      controls.focus(target.mesh.position)
      canvas.focus({ preventScroll: true })
    },
    /**
     * 玩家模式下排队重生命令，下一固定步执行；否则恢复观察相机初始机位。随后聚焦画布。
     *
     * @returns {void}
     */
    resetCamera() {
      if (mode === 'player')
        level.player.requestRespawn()
      else
        controls?.reset()
      canvas.focus({ preventScroll: true })
    },
    /**
     * 暂停或继续茶壶漂浮。没有茶壶时不做事。
     *
     * @param {boolean} value `true` 为暂停。
     * @returns {void}
     */
    setPaused: value => target?.setPaused(value),
    /**
     * 开关房间阴影。没有阴影对象时不做事。
     *
     * @param {boolean} value `true` 为开启阴影。
     * @returns {void}
     */
    setShadows: value => level.shadows?.setEnabled(value),
    /**
     * 开关碰撞辅助线。没有辅助线对象时不做事。
     *
     * @param {boolean} value `true` 为显示。
     * @returns {void}
     */
    setCollisionDebug: value => collisionDebug?.setVisible(value),
    /**
     * 收集当前模式、飞行速度、茶壶、阴影和玩家步进。
     *
     * @returns {InspectionSnapshot} 当前观察状态。
     */
    snapshot() {
      return {
        cameraMode: mode,
        flySpeed: controls?.speed ?? 0,
        target: target?.snapshot(),
        shadows: level.shadows?.snapshot(),
        player: level.player
          ? {
              ...level.player.snapshot(),
              mode,
              boxes: level.collision.world.boxes.length,
              stepMs: physics.lastStepMs,
              collisionDebug: collisionDebug?.visible ?? false,
            }
          : null,
      }
    },
  }
  controls?.setMode(mode === 'player'
    ? 'none'
    : 'fly')
  if (controls && startMode === 'fly')
    api.setMode('fly')
  return api
}
