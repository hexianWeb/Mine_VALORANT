// @ts-check

import { createEditor } from '../engine/editor/editor.js'
import { Disposer, RuntimeContext } from '../engine/runtime/index.js'
import { RangeRoomLevel } from '../game/range-room/level.js'
import { readAppConfig } from './config.js'
import { installDiagnostics } from './diagnostics.js'
import { showEntryCredits } from './entry-credits.js'
import { mountInputOverlay } from './input-overlay.js'
import { mountKillInfoPanel } from './kill-info-panel.js'
import { mountRangeSettings } from './range-settings.js'
import { mountTouchControls } from './touch-controls.js'
import { createUiHost } from './ui-host.js'
import { createUiInput } from './ui-input.js'
import { mountWeaponHud } from './weapon-hud.js'
import { mountWeaponShop } from './weapon-shop.js'

/**
 * 标准 `Navigator` 尚未包含 WebGPU 入口。浏览器不支持时没有 `gpu`。
 *
 * @typedef {Navigator & { gpu?: object }} WebGpuNavigator
 */

/**
 * `readAppConfig()` 的返回值。
 * `?editor=0` 关闭调试工具，`?player=0` 使用固定参考机位，`?probes=0` 关闭探针，
 * `?lighting=appearance` 改用外观清单，`?ao=0` 关闭环境光遮蔽，`?aa=none` 关闭抗锯齿，`?profile=1` 记录时间戳。
 * `?reflectionPreview=1` 在大厅中央显示已保存 HDR Cubemap 的六面原始预览。
 *
 * @typedef {ReturnType<typeof readAppConfig>} AppConfig
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
 * 连接关系：`RuntimeContext` 持有场景、渲染、输入、物理和帧循环；`RangeRoomLevel` 持有房间、玩家和光照；
 * `createEditor` 持有渲染面板和碰撞辅助线；
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
    pointerLock: !options.touchControls,
    autoPauseOnHidden: false,
  })
  /** 跟随整个应用。登记的清理函数读取当前 `levelTools`，卸下的是最后一关的工具。 */
  const owned = new Disposer()
  /** 只跟随当前关卡。每次 `load` 替换，`unload` 时释放。 */
  let levelTools = new Disposer()
  let showedEntryCredits = false
  owned.add(() => levelTools.dispose())
  runtime.events.on('dispose', () => owned.dispose())
  if (panelContainer)
    panelContainer.hidden = !options.editor

  /**
   * 关卡 `load` 之后挂上这一关的工具。
   * 先释放上一关的 `levelTools`，再换一个新的清理器。
   * 编辑器开启时创建调试工具。两种情况都会安装诊断。
   *
   * @param {RangeRoomLevel} level 刚加载完成的关卡。
   * @returns {void}
   */
  const mountLevelTools = (level) => {
    levelTools.dispose()
    levelTools = new Disposer()
    // 关卡已从清单设置参考机位；在玩家首次更新相机前停用玩家。
    if (options.referenceCamera)
      level.setPlayerEnabled(false)
    const ui = levelTools.add(createUiHost({ canvas, debugContainer: panelContainer }))
    const editor = options.editor
      ? levelTools.add(createEditor({
          scene: runtime.scene,
          render: runtime.render,
          panelContainer,
          lightingMode: level.snapshot().lightingMode,
          probes: level.probes,
          collisionBoxes: level.collision?.world.boxes,
        }))
      : null
    if (level.player) {
      let weaponHud = null
      let weaponShop = null
      for (const event of ['pause', 'resume']) {
        levelTools.add(runtime.engine.events.on(event, () => {
          level.challenge?.pausePlaytest(event === 'pause', runtime.engine.time.fixedElapsed)
        }))
      }
      const settings = levelTools.add(mountRangeSettings({
        ui,
        player: level.player,
        engine: runtime.engine,
        challenge: level.challenge,
        inputLayout: options.touchControls ? 'touch' : 'keyboard-mouse',
        readChallengeHud: () => level.readChallengeHud(),
        onCrosshair: () => weaponHud?.openCrosshair(),
      }))
      const inputUi = levelTools.add(createUiInput({
        canvas,
        ui,
        input: runtime.input,
        player: level.player,
        engine: runtime.engine,
        onSettings: () => {
          if (!ui.topModal || ui.topModal === 'range-settings')
            settings.toggle()
        },
        onShop: () => {
          if (weaponShop)
            weaponShop.open()
          else
            inputUi.announce('当前关卡未提供武器目录')
        },
      }))
      if (level.player.weapons) {
        weaponShop = levelTools.add(mountWeaponShop({
          ui,
          weapons: level.player.weapons,
          engine: runtime.engine,
          onNotice: message => inputUi.announce(message),
        }))
      }
      levelTools.add(mountInputOverlay({
        ui,
        controls: inputUi,
        onSettings: settings.toggle,
        onTouchAction(action) {
          runtime.input.setVirtualButton('shortcut', action, true)
          runtime.input.setVirtualButton('shortcut', action, false)
        },
      }))
      weaponHud = levelTools.add(mountWeaponHud({
        canvas,
        player: level.player,
        engine: runtime.engine,
        ui,
        controls: inputUi,
      }))
      if (level.challenge) {
        levelTools.add(mountKillInfoPanel({
          ui,
          engine: runtime.engine,
          controls: inputUi,
          readFeedback: () => level.readKillFeedback(),
        }))
      }
      if (options.touchControls) {
        levelTools.add(mountTouchControls({
          ui,
          controls: inputUi,
          input: runtime.input,
          weapons: level.player.weapons,
          engine: runtime.engine,
          unlockAudio: () => runtime.audio.unlock(),
          onShop: () => weaponShop?.open(),
          onSettings: settings.toggle,
        }))
      }
      const syncSettings = state => settings.setEnabled(state.mode !== 'editor')
      levelTools.add(inputUi.subscribe(syncSettings))
      syncSettings(inputUi.read())
      if (level.player.enabled && !showedEntryCredits) {
        showEntryCredits({
          ui,
          onEnter(event) {
            if (event.isTrusted)
              void runtime.audio.unlock()
            inputUi.continue()
          },
        })
        showedEntryCredits = true
      }
    }
    levelTools.add(installDiagnostics({
      runtime,
      level,
      editor,
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
        if (!browser.gpu) {
          throw new Error(globalThis.isSecureContext === false
            ? 'WebGPU 需要安全连接，请通过 HTTPS 打开靶场。'
            : '当前浏览器或设备不支持 WebGPU，请使用支持 WebGPU 的浏览器。')
        }
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
          particles: runtime.particles,
          fixedDelta: runtime.engine.time.fixedDelta,
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
