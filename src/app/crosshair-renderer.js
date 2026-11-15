function addLineRects(rectangles, line, width, height, ratio, movement, firing) {
  if (!line?.thickness || !line.opacity)
    return
  const horizontal = Math.round(line.length * ratio)
  const vertical = Math.round(line.verticalLength * ratio)
  const thickness = Math.max(1, Math.round(line.thickness * ratio))
  const offset = line.offset + movement * (line.movementScale ?? 0) + firing * (line.firingScale ?? 0)
  let gap = Math.round(2 * offset * ratio)
  // Match thickness parity so opposite arms have an exact shared pixel center.
  gap += (gap + thickness) % 2
  const left = Math.round((width - 2 * horizontal - gap) / 2)
  const top = Math.round((height - 2 * vertical - gap) / 2)
  const middleX = left + horizontal + (gap - thickness) / 2
  const middleY = top + vertical + (gap - thickness) / 2
  if (horizontal) {
    rectangles.push([
      left,
      middleY,
      horizontal,
      thickness,
      line.opacity,
    ])
    rectangles.push([
      left + horizontal + gap,
      middleY,
      horizontal,
      thickness,
      line.opacity,
    ])
  }
  if (vertical) {
    rectangles.push([
      middleX,
      top,
      thickness,
      vertical,
      line.opacity,
    ])
    rectangles.push([
      middleX,
      top + vertical + gap,
      thickness,
      vertical,
      line.opacity,
    ])
  }
}

export function crosshairRects(style, width, height, ratio, { movement = 0, firing = 0 } = {}) {
  const rectangles = []
  const fireOffset = style.fixedFiringOffset ? 0 : firing
  addLineRects(rectangles, style.outer, width, height, ratio, movement, fireOffset)
  addLineRects(rectangles, style.inner, width, height, ratio, movement, fireOffset)
  if (style.dot?.size && style.dot.opacity) {
    const size = Math.max(1, Math.round(style.dot.size * ratio))
    rectangles.push([
      Math.round((width - size) / 2),
      Math.round((height - size) / 2),
      size,
      size,
      style.dot.opacity,
    ])
  }
  return rectangles
}

export function createCrosshairRenderer(canvas) {
  const context = canvas.getContext('2d')
  let previous = null

  return (style, ratio, { movement = 0, firing = 0, hit = false } = {}) => {
    if (previous)
      context.clearRect(...previous)
    previous = null
    if (!style)
      return
    const rectangles = crosshairRects(style, canvas.width, canvas.height, ratio, { movement, firing })
    if (!rectangles.length)
      return
    const rim = style.outline?.opacity
      ? Math.max(1, Math.round(style.outline.thickness * ratio))
      : 0
    const left = Math.min(...rectangles.map(([x]) => x)) - rim
    const top = Math.min(...rectangles.map(([, y]) => y)) - rim
    const right = Math.max(...rectangles.map(([x, , width]) => x + width)) + rim
    const bottom = Math.max(...rectangles.map(([, y, , height]) => y + height)) + rim
    previous = [left, top, right - left, bottom - top]
    context.save()
    if (rim) {
      context.fillStyle = '#000000'
      context.globalAlpha = style.outline.opacity
      for (const [x, y, width, height] of rectangles)
        context.fillRect(x - rim, y - rim, width + 2 * rim, height + 2 * rim)
      // Leave the fill area transparent before painting its own opacity.
      context.globalCompositeOperation = 'destination-out'
      context.globalAlpha = 1
      for (const [x, y, width, height] of rectangles)
        context.fillRect(x, y, width, height)
      context.globalCompositeOperation = 'source-over'
    }
    context.fillStyle = hit ? '#ffdf8b' : style.color
    for (const [x, y, width, height, opacity] of rectangles) {
      context.globalAlpha = opacity
      context.fillRect(x, y, width, height)
    }
    context.restore()
  }
}
