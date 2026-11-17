import {
  BackSide,
  CanvasTexture,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Vector3,
} from 'three/webgpu'
import { Disposer } from '../../../engine/runtime/core/disposer.js'
import { RangePanelControl } from './panel-control.js'

// Measured display-face centers and dimensions from the Blender scene.
// screen-top is viewed from its geometric back, so use the player-facing normal.
const controlSpec = {
  name: 'screen-bottom',
  center: [0.499413, 1.844268, 9.595418],
  normal: [0, 0.917839, 0.396952],
  width: 2.951843,
  height: 1.173260,
}
const scoreSpec = {
  name: 'screen-top',
  center: [0.543338, -13.785929, 16.310728],
  normal: [0, 1, 0],
  width: 7.189490,
  height: 2.489844,
}
const fromBlender = ([x, y, z]) => new Vector3(x, z, -y)
const faceRight = new Vector3(-1, 0, 0)
const font = '"Microsoft YaHei UI", "Noto Sans CJK SC", sans-serif'
const numberFont = '"DSEG7 Classic", "Bahnschrift", "Segoe UI", sans-serif'

// Coordinates use the artwork's top-left origin. The same rectangles draw and handle shots.
const buttons = [
  {
    id: 'start',
    action: 'start',
    x: 0.335,
    y: 0.313,
    size: 0.132,
  },
  {
    id: 'practice',
    action: 'practice',
    x: 0.335,
    y: 0.55,
    size: 0.132,
  },
  {
    id: 'minus-coarse',
    action: 'sensitivity',
    x: 0.1,
    y: 0.803,
    size: 0.145,
    delta: -0.1,
  },
  {
    id: 'minus-fine',
    action: 'sensitivity',
    x: 0.184,
    y: 0.803,
    size: 0.09,
    delta: -0.01,
  },
  {
    id: 'plus-fine',
    action: 'sensitivity',
    x: 0.815,
    y: 0.803,
    size: 0.09,
    delta: 0.01,
  },
  {
    id: 'plus-coarse',
    action: 'sensitivity',
    x: 0.9,
    y: 0.803,
    size: 0.145,
    delta: 0.1,
  },
].map(button => ({
  ...button,
  halfU: button.size / 2 * controlSpec.height / controlSpec.width,
  halfV: button.size / 2,
}))

function createFace(owned, document, spec, anisotropy) {
  const { name, width, height } = spec
  const center = fromBlender(spec.center)
  const normal = fromBlender(spec.normal).normalize()
  const up = new Vector3().crossVectors(normal, faceRight)
  const board = document.createElement('canvas')
  board.width = 1024
  board.height = Math.round(board.width * height / width)
  const ctx = board.getContext('2d')
  const texture = owned.add(new CanvasTexture(board))
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = Math.min(anisotropy, 8)
  const geometry = owned.add(new PlaneGeometry(width, height))
  const display = new Mesh(geometry, owned.add(new MeshBasicMaterial({ map: texture, toneMapped: false })))
  display.name = name
  display.position.copy(center)
  display.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(faceRight, up, normal))
  const back = new Mesh(geometry, owned.add(new MeshBasicMaterial({ color: 0x263139, side: BackSide })))
  back.name = `${name}-back`
  display.add(back)
  const frontNormal = Object.freeze(normal.toArray())
  const backNormal = Object.freeze(normal.clone().negate().toArray())
  const point = new Vector3()
  const incoming = new Vector3()
  let key
  let uploads = 0
  return {
    display,
    paint(nextKey, draw) {
      if (key === nextKey)
        return
      draw(ctx, board.width, board.height)
      texture.needsUpdate = true
      key = nextKey
      uploads++
    },
    trace(origin, direction, limit) {
      incoming.fromArray(direction)
      const dot = normal.dot(incoming)
      if (Math.abs(dot) < 1e-8)
        return null
      point.fromArray(origin).sub(center)
      const distance = -point.dot(normal) / dot
      if (distance <= 0 || distance >= limit)
        return null
      point.addScaledVector(incoming, distance)
      const u = 0.5 + point.dot(faceRight) / width
      const v = 0.5 - point.dot(up) / height
      if (u < 0 || u > 1 || v < 0 || v > 1)
        return null
      return {
        distance,
        u,
        v,
        front: dot < 0,
        normal: dot < 0
          ? frontNormal
          : backNormal,
        surface: 'metal',
      }
    },
    snapshot() {
      return {
        name,
        width,
        height,
        center: center.toArray(),
        normal: frontNormal,
        up: up.toArray(),
        right: faceRight.toArray(),
        uploads,
      }
    },
  }
}

function polyline(ctx, points) {
  ctx.beginPath()
  ctx.moveTo(...points[0])
  for (const point of points.slice(1)) ctx.lineTo(...point)
  ctx.stroke()
}

function scanlines(ctx, w, h, inset) {
  ctx.fillStyle = '#c5ebff08'
  for (let y = inset + 3; y < h - inset; y += 4) ctx.fillRect(inset, y, w - 2 * inset, 1)
}

function bracket(ctx, button, w, h, active) {
  const x = button.x * w
  const y = button.y * h
  const dx = button.halfU * w
  const dy = button.halfV * h
  const notch = dy * 0.61
  ctx.lineWidth = 2
  ctx.strokeStyle = active ? '#c4f0fc' : '#7193a5'
  ctx.fillStyle = active ? '#83caff12' : '#0916215c'
  ctx.fillRect(x - dx, y - dy, dx * 2, dy * 2)
  for (const side of [-1, 1]) {
    for (const vertical of [-1, 1]) {
      const cornerX = x + side * dx
      const cornerY = y + vertical * dy
      polyline(ctx, [
        [cornerX - side * notch, cornerY],
        [cornerX, cornerY],
        [cornerX, cornerY - vertical * notch],
      ])
    }
  }
}

function paintControl(ctx, w, h, model) {
  ctx.fillStyle = '#1b2735'
  ctx.fillRect(0, 0, w, h)
  const background = ctx.createLinearGradient(0, 0, 0, h)
  background.addColorStop(0, '#38536c')
  background.addColorStop(0.54, '#2a3e57')
  background.addColorStop(1, '#30475e')
  ctx.fillStyle = background
  ctx.fillRect(7, 7, w - 14, h - 14)
  ctx.strokeStyle = '#77edfa'
  ctx.lineWidth = 2
  ctx.strokeRect(11, 11, w - 22, h - 22)
  scanlines(ctx, w, h, 13)
  ctx.strokeStyle = '#a6d8ef4e'
  polyline(ctx, [
    [0.192 * w, 12],
    [0.245 * w, 0.18 * h],
    [0.755 * w, 0.18 * h],
    [0.808 * w, 12],
  ])
  polyline(ctx, [
    [0.192 * w, h - 12],
    [0.27 * w, 0.737 * h],
    [0.73 * w, 0.737 * h],
    [0.808 * w, h - 12],
  ])
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#b8d9e7'
  ctx.font = `${h * 0.105}px ${font}`
  ctx.fillText('战技测试', w * 0.5, h * 0.109)
  ctx.font = `bold ${h * 0.106}px "Bahnschrift", sans-serif`
  ctx.fillText('−', w * 0.10, h * 0.663)
  ctx.fillText('+', w * 0.90, h * 0.663)
  const sensitivityLabel = '瞄准灵敏度'
  const labelFont = `${h * 0.084}px ${font}`
  const sensitivityY = h * 0.869
  const gap = w * 0.034
  ctx.font = labelFont
  const labelMetrics = ctx.measureText(sensitivityLabel)
  ctx.font = `700 ${h * 0.097}px ${numberFont}`
  const valueMetrics = ctx.measureText(model.sensitivity)
  const valueY = sensitivityY + (valueMetrics.actualBoundingBoxAscent - valueMetrics.actualBoundingBoxDescent) / 2
  ctx.fillText(model.sensitivity, (w + labelMetrics.width + gap) / 2, valueY)
  ctx.font = labelFont
  const labelY = sensitivityY + (labelMetrics.actualBoundingBoxAscent - labelMetrics.actualBoundingBoxDescent) / 2
  ctx.fillText(sensitivityLabel, (w - valueMetrics.width - gap) / 2, labelY)
  for (const button of buttons) {
    bracket(ctx, button, w, h, button.action === 'start'
      ? model.startReady
      : model.canAdjust)
  }
  if (model.practice) {
    ctx.fillStyle = '#dffaff'
    ctx.font = `bold ${h * 0.071}px sans-serif`
    ctx.fillText('+', w * buttons[1].x, h * buttons[1].y)
  }
  ctx.textAlign = 'left'
  ctx.font = `${h * 0.145}px ${font}`
  ctx.fillStyle = model.startReady ? '#ccebf5' : '#91aab9'
  ctx.fillText('开始', w * 0.399, h * buttons[0].y)
  ctx.fillStyle = model.canAdjust ? '#ccebf5' : '#91aab9'
  ctx.fillText('练习', w * 0.399, h * buttons[1].y)
}

function paintScore(ctx, w, h, columns) {
  const frame = ctx.createLinearGradient(0, 0, 0, h)
  frame.addColorStop(0, '#777d80')
  frame.addColorStop(0.28, '#323b41')
  frame.addColorStop(0.82, '#343c42')
  frame.addColorStop(1, '#626b6e')
  ctx.fillStyle = frame
  ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = '#a2a9a4'
  ctx.lineWidth = 1.5
  ctx.strokeRect(5, 5, w - 10, h - 10)
  const glass = ctx.createLinearGradient(0, 0, 0, h)
  glass.addColorStop(0, '#344556')
  glass.addColorStop(1, '#424a60')
  ctx.fillStyle = glass
  ctx.fillRect(15, 15, w - 30, h - 30)
  scanlines(ctx, w, h, 16)
  ctx.shadowColor = '#83efff'
  ctx.shadowBlur = 8
  ctx.strokeStyle = '#8fe9f1'
  ctx.lineWidth = 2
  ctx.strokeRect(18, 17, w - 36, h - 34)
  ctx.fillStyle = '#a5f6fc'
  for (const x of [0.031, 0.963]) ctx.fillRect(x * w, 0.24 * h, 5, 0.49 * h)
  ctx.shadowBlur = 0
  for (const x of [26, w - 26]) {
    for (const y of [25, h - 25]) {
      ctx.beginPath()
      ctx.arc(x, y, 8, 0, 2 * Math.PI)
      ctx.fillStyle = '#222b30'
      ctx.fill()
      ctx.strokeStyle = '#7e8788'
      ctx.lineWidth = 2
      polyline(ctx, [
        [x - 3, y + 3],
        [x + 3, y - 3],
      ])
    }
  }
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (const [index, { label, value }] of columns.entries()) {
    const x = w * (index === 0
      ? 0.24
      : 0.76)
    ctx.fillStyle = '#b4d5e2'
    ctx.font = `${h * 0.116}px ${font}`
    ctx.fillText(label, x, h * 0.217)
    let size = h * 0.44
    ctx.font = `700 ${size}px ${numberFont}`
    size *= Math.min(1, w * 0.37 / ctx.measureText(value).width)
    ctx.font = `700 ${size}px ${numberFont}`
    ctx.fillStyle = '#bdf8ff'
    ctx.shadowColor = '#71efff'
    ctx.shadowBlur = 12
    ctx.fillText(value, x, h * 0.682)
    ctx.shadowBlur = 0
  }
}

export function createRangeWorldPanels({ document, scene, targets, readControl, anisotropy }) {
  const owned = new Disposer()
  try {
    const bottom = createFace(owned, document, controlSpec, anisotropy)
    const top = createFace(owned, document, scoreSpec, anisotropy)
    const root = new Group()
    root.name = 'Range world panels'
    root.add(bottom.display, top.display)
    scene.add(root)
    owned.add(() => root.removeFromParent())
    for (const button of buttons) {
      const id = `${controlSpec.name}:${button.id}`
      owned.add(targets.register(id, new RangePanelControl({
        id,
        action: button.action,
        delta: button.delta,
        readState: () => readControl(button.action),
        trace(origin, direction, limit) {
          const hit = bottom.trace(origin, direction, limit)
          return hit?.front && Math.abs(hit.u - button.x) <= button.halfU && Math.abs(hit.v - button.y) <= button.halfV
            ? hit
            : null
        },
      })))
    }
    // Full surfaces participate in the same nearest-hit chain, including between controls
    // and on the back. Register after controls so an exact distance tie goes to the button.
    owned.add(targets.register(controlSpec.name, { trace: bottom.trace }))
    owned.add(targets.register(scoreSpec.name, { trace: top.trace }))
    let latestModel = null
    let numbersLoaded = false
    const update = (model) => {
      latestModel = model
      bottom.paint(`${numbersLoaded}/${model.startReady}/${model.canAdjust}/${model.practice}/${model.sensitivity}`, (ctx, w, h) => paintControl(ctx, w, h, model))
      const score = model.columns.map(column => `${column.label} ${column.value}`).join('/')
      top.paint(`${numbersLoaded}/${score}`, (ctx, w, h) => paintScore(ctx, w, h, model.columns))
    }
    document.fonts?.load(`700 24px ${numberFont}`, '0123456789').then((faces) => {
      if (owned.disposed || !faces.length)
        return
      numbersLoaded = true
      if (latestModel)
        update(latestModel)
    }, () => { /* The fallback font already draws the panels. */ })
    return {
      surfaces: [bottom.display, top.display],
      update,
      snapshot() {
        return {
          bottom: bottom.snapshot(),
          top: top.snapshot(),
          controls: buttons.map(button => ({ ...button })),
        }
      },
      dispose: () => owned.dispose(),
    }
  }
  catch (error) {
    owned.dispose()
    throw error
  }
}
