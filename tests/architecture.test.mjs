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

test('source and test references resolve without legacy controls/systems paths', () => {
  for (const legacy of ['controls', 'systems'])
    assert.equal(fs.existsSync(path.join(sourceRoot, 'engine', legacy)), false, `engine/${legacy} must not return`)
  for (const file of [
    ...files,
    ...modules(testRoot),
  ]) {
    for (const target of references(file)) {
      assert.ok(fs.existsSync(target), `${relative(file)} -> ${relative(target)} does not exist`)
      assert.doesNotMatch(relative(target), /^engine\/(?:controls|systems)\//)
    }
  }
})

test('engine dependency direction is function -> resources -> core, never world/application', () => {
  const allowed = {
    'index.js': ['core', 'resources'],
    'core': ['core'],
    'resources': ['resources', 'core'],
    'function': ['function', 'resources', 'core'],
  }
  for (const { from, to } of edges.filter(edge => edge.from.startsWith('engine/'))) {
    const layer = from.split('/')[1]
    assert.ok(to.startsWith('engine/'), `${from} must not depend on application/world module ${to}`)
    assert.ok(allowed[layer]?.includes(to.split('/')[1]), `${from} must not depend on ${to}`)
  }
})

test('production callers use feature index.js instead of feature internals', () => {
  for (const { from, to } of edges) {
    const target = to.match(/^engine\/function\/([^/]+)\/(.+)$/)
    if (!target || from.startsWith(`engine/function/${target[1]}/`))
      continue
    assert.equal(target[2], 'index.js', `${from} must use the public entry of ${target[1]}`)
  }
})

test('world content never depends on application composition or UI', () => {
  for (const { from, to } of edges.filter(edge => edge.from.startsWith('world/')))
    assert.ok(to.startsWith('world/') || to.startsWith('engine/'), `${from} must not depend on ${to}`)
})

test('function features are directories with importable public entries', async () => {
  const directory = path.join(sourceRoot, 'engine/function')
  const expected = {
    'fly-controller': ['FlyController'],
    'input': ['createInputSystem'],
    'physics': [
      'CollisionWorld',
      'createPhysicsSystem',
      'moveAABB',
      'overlaps',
    ],
    'render': ['createRenderSystem', 'gradingPresets', 'renderConfig'],
    'animation': [], // Contract-only placeholder, not an implemented runtime system.
  }
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    assert.ok(entry.isDirectory(), `function/${entry.name} must be a feature directory`)
    assert.ok(fs.existsSync(path.join(directory, entry.name, 'index.js')))
  }
  for (const [feature, names] of Object.entries(expected)) {
    const api = await import(pathToFileURL(path.join(directory, feature, 'index.js')).href)
    for (const name of names)
      assert.ok(api[name], `function/${feature}/index.js must export ${name}`)
  }
})
