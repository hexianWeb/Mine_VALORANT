import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url))
const testRoot = fileURLToPath(new URL('./', import.meta.url))
const relative = file => path.relative(sourceRoot, file).split(path.sep).join('/')

function modules(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name)
    return entry.isDirectory()
      ? modules(file)
      : /\.m?js$/.test(entry.name)
        ? [file]
        : []
  })
}

function references(file) {
  const source = fs.readFileSync(file, 'utf8')
  // Static imports/re-exports, literal dynamic imports (including JSDoc), and worker URLs.
  const imports = source.matchAll(/\b(?:from\s+|import\s*(?:\(\s*)?)['"](\.[^'"]+)['"]/g)
  const urls = source.matchAll(/\bnew URL\(\s*['"](\.[^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g)
  return [
    ...imports,
    ...urls,
  ]
    .map(([, specifier]) => path.resolve(path.dirname(file), specifier))
}

const files = modules(sourceRoot)
const edges = files.flatMap(file => references(file).map(target => ({
  from: relative(file),
  to: relative(target),
})))

test('source and test references resolve without legacy engine/world paths', () => {
  for (const file of [
    ...files,
    ...modules(testRoot),
  ]) {
    for (const target of references(file)) {
      assert.ok(fs.existsSync(target), `${relative(file)} -> ${relative(target)} does not exist`)
      assert.doesNotMatch(relative(target), /^(?:world\/|engine\/(?:core|resources|function|controls|systems)\/)/)
    }
  }
})

test('runtime dependencies point inward and never import editor/game/app', () => {
  const allowed = {
    'global': [
      'core',
      'platform',
      'resource',
      'function',
      'engine.js',
    ],
    'core': ['core'],
    'platform': ['platform', 'core'],
    'resource': ['resource', 'platform', 'core'],
    'function': [
      'function',
      'resource',
      'platform',
      'core',
    ],
    'engine.js': ['core', 'platform'],
  }
  for (const { from, to } of edges.filter(edge => edge.from.startsWith('engine/runtime/'))) {
    const layer = from.startsWith('engine/runtime/function/global/')
      ? 'global'
      : from.split('/')[2]
    assert.ok(to.startsWith('engine/runtime/'), `${from} must not depend on ${to}`)
    if (to.startsWith('engine/runtime/function/global/'))
      assert.ok(layer === 'global' || from === 'engine/runtime/index.js', `${from} must receive services rather than import ${to}`)
    if (allowed[layer])
      assert.ok(allowed[layer].includes(to.split('/')[2]), `${from} must not depend on ${to}`)
  }
})

test('game and editor stay independent and only app connects them', () => {
  for (const { from, to } of edges) {
    if (from.startsWith('game/'))
      assert.ok(to.startsWith('game/') || to.startsWith('engine/runtime/'), `${from} must not depend on ${to}`)
    if (from.startsWith('engine/editor/'))
      assert.ok(to.startsWith('engine/editor/') || to.startsWith('engine/runtime/'), `${from} must not depend on ${to}`)
  }
})

test('source dependency graph is acyclic', () => {
  const complete = new Set()
  function visit(file, stack = new Set()) {
    if (complete.has(file))
      return
    assert.ok(!stack.has(file), `Circular dependency: ${[...stack, file].join(' -> ')}`)
    const next = new Set([...stack, file])
    for (const edge of edges.filter(edge => edge.from === file)) visit(edge.to, next)
    complete.add(file)
  }
  for (const file of files) visit(relative(file))
})

test('runtime public APIs import without a browser or game initialization', async () => {
  const expected = {
    'index.js': [
      'Engine',
      'RuntimeContext',
      'Time',
      'Disposer',
    ],
    'function/global/runtime-context.js': ['RuntimeContext'],
    'function/input/input-system.js': ['createInputSystem'],
    'function/character/character-motion.js': ['characterBox', 'characterMotion'],
    'function/controller/character-controller.js': ['moveAABB'],
    'function/framework/index.js': [
      'WorldManager',
      'Level',
      'GameObject',
      'Component',
      'TransformComponent',
      'MeshComponent',
      'MotorComponent',
      'CameraComponent',
    ],
    'function/physics/index.js': [
      'CollisionWorld',
      'createPhysicsSystem',
      'overlaps',
    ],
    'function/render/index.js': ['createRenderSystem', 'gradingPresets', 'renderConfig'],
    'resource/index.js': ['ResourceManager', 'disposeObject3D'],
  }
  for (const [entry, names] of Object.entries(expected)) {
    const api = await import(pathToFileURL(path.join(sourceRoot, 'engine/runtime', entry)).href)
    for (const name of names)
      assert.ok(api[name], `${entry} must export ${name}`)
  }
})
