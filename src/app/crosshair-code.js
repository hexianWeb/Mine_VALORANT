const colors = [
  '#ffffff',
  '#00ff00',
  '#7fff00',
  '#dfff00',
  '#ffff00',
  '#00ffff',
  '#ff00ff',
  '#ff0000',
]

const defaultStyle = Object.freeze({
  color: '#27eae0',
  inner: Object.freeze({
    length: 3,
    verticalLength: 3,
    thickness: 2,
    offset: 1,
    opacity: 1,
  }),
})

export const defaultCrosshairProfile = Object.freeze({
  code: '',
  primary: defaultStyle,
  ads: defaultStyle,
  sniper: Object.freeze({
    color: '#ffffff',
    dot: Object.freeze({ size: 1, opacity: 0.75 }),
  }),
  extraFields: Object.freeze([]),
})

function readSection(name) {
  const fields = new Map()
  const take = (key) => {
    const value = fields.get(key)
    fields.delete(key)
    return value
  }
  return {
    fields,
    number(key, fallback, min, max, integer = true) {
      const raw = take(key)
      if (raw === undefined)
        return fallback
      const number = Number(raw)
      if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/u.test(raw) || number < min || number > max || (integer && !Number.isInteger(number)))
        throw new SyntaxError(`${name} 段的 ${key} 应为 ${min}–${max} ${integer ? '之间的整数' : '之间的数值'}。`)
      return number
    },
    flag(key, fallback) {
      return this.number(key, Number(fallback), 0, 1) === 1
    },
    color(customKey) {
      const colorIndex = this.number('c', 0, 0, 8)
      const custom = take(customKey)?.replace(/^#/u, '').toLowerCase()
      if (custom !== undefined && !/^(?:[\da-f]{6}|[\da-f]{8})$/u.test(custom))
        throw new SyntaxError(`${name} 段的 ${customKey} 应为 6 或 8 位十六进制颜色。`)
      return colorIndex === 8 && custom
        ? `#${custom}`
        : colors[colorIndex] ?? colors[0]
    },
  }
}

function readLines(section, prefix) {
  const enabled = section.flag(`${prefix}b`, true)
  const length = section.number(`${prefix}l`, 6, 0, 20)
  const vertical = section.number(`${prefix}v`, 6, 0, 20)
  const separate = section.flag(`${prefix}g`, false)
  const thickness = section.number(`${prefix}t`, 2, 0, 10)
  const offset = section.number(`${prefix}o`, 3, 0, 20)
  const opacity = section.number(`${prefix}a`, 0.8, 0, 1, false)
  const movementError = section.flag(`${prefix}m`, false)
  const firingError = section.flag(`${prefix}f`, true)
  const movementScale = section.number(`${prefix}s`, 1, 0, 3, false)
  const firingScale = section.number(`${prefix}e`, 1, 0, 3, false)
  if (!enabled)
    return null
  return {
    length,
    verticalLength: separate ? vertical : length,
    thickness,
    offset,
    opacity,
    movementScale: movementError ? movementScale : 0,
    firingScale: firingError ? firingScale : 0,
  }
}

function readStyle(section) {
  const color = section.color('u')
  section.flag('b', false) // Custom-color marker also appears in exported codes.
  const outline = section.flag('h', true)
  const outlineStyle = {
    thickness: section.number('t', 1, 1, 6),
    opacity: section.number('o', 0.5, 0, 1, false),
  }
  const dot = section.flag('d', false)
  const dotStyle = {
    size: section.number('z', 2, 1, 6),
    opacity: section.number('a', 1, 0, 1, false),
  }
  return {
    color,
    outline: outline ? outlineStyle : null,
    dot: dot ? dotStyle : null,
    fixedFiringOffset: section.flag('m', false),
    inner: readLines(section, '0'),
    outer: readLines(section, '1'),
  }
}

function readSniper(section) {
  const color = section.color('t')
  const enabled = section.flag('d', true)
  const dot = {
    size: section.number('s', 1, 0, 4, false),
    opacity: section.number('o', 0.75, 0, 1, false),
  }
  return {
    color,
    dot: enabled ? dot : null,
  }
}

export function parseCrosshairCode(text) {
  const code = text.trim()
  const tokens = code.split(';').map(token => token.trim())
  if (tokens[0] !== '0')
    throw new SyntaxError('请粘贴以 0 开头的 VALORANT 准星代码。')
  if (tokens.at(-1) === '')
    tokens.pop()

  const sections = new Map(['0', 'P', 'A', 'S'].map(name => [
    name,
    readSection(name),
  ]))
  let section = sections.get('0')
  for (let index = 1; index < tokens.length; index++) {
    const key = tokens[index]
    if (key !== '0' && sections.has(key)) {
      section = sections.get(key)
      continue
    }
    const value = tokens[++index]
    if (!/^\d*[a-z]+$/iu.test(key) || !value)
      throw new SyntaxError('代码中的准星字段缺少有效的名称或值。')
    section.fields.set(key, value)
  }

  const general = sections.get('0')
  const advanced = general.flag('s', false)
  const usePrimaryForAds = general.flag('p', true)
  const primary = readStyle(sections.get('P'))
  const ads = readStyle(sections.get('A'))
  const sniper = readSniper(sections.get('S'))
  return {
    code,
    advanced,
    primary,
    ads: usePrimaryForAds ? primary : ads,
    sniper,
    extraFields: Array.from(sections, ([name, { fields }]) => [
      ...fields.keys(),
    ].map(key => `${name}.${key}`)).flat(),
  }
}
