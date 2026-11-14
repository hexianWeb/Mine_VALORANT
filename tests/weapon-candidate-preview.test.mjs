import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { weaponPreviewOptions } from '../src/dev/weapon-preview-options.js'
import { candidateAssetMiddleware, weaponCandidatePlugin } from '../tools/weapons/preview-assets.mjs'

async function fixture(t) {
  const work = 'D:/opencode-temp/opencode'
  await mkdir(work, { recursive: true })
  const directory = await mkdtemp(path.join(work, 'weapon-preview-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const root = path.join(directory, 'candidates')
  const candidate = path.join(root, 'candidate-test', 'classic', 'v4')
  await mkdir(candidate, { recursive: true })
  await writeFile(path.join(candidate, 'manifest.json'), '{"candidate":true}')
  return {
    directory,
    root,
    candidate,
    middleware: candidateAssetMiddleware(root),
  }
}

async function dispatch(middleware, url, { method = 'GET', address = '127.0.0.1', headers = {} } = {}) {
  const result = { status: 200, headers: {}, next: false }
  await middleware({
    url,
    method,
    socket: { remoteAddress: address },
    headers,
  }, {
    get statusCode() { return result.status },
    set statusCode(value) { result.status = value },
    setHeader(name, value) { result.headers[name] = value },
    end(body) { result.body = body },
  }, () => { result.next = true })
  return result
}

test('candidate URLs are dev-only, explicit and scoped to one weapon', () => {
  assert.deepEqual(weaponPreviewOptions('', false), { weapon: 'classic', candidate: null, baseUrl: '/weapons/' })
  const query = '?candidate=candidate-abc&weapon=classic&version=v4&skin=ag'
  assert.equal(weaponPreviewOptions(query, true).baseUrl, '/__weapon_preview__/candidate-abc/')
  assert.equal(weaponPreviewOptions('?weapon=ghost', false).weapon, 'ghost')
  assert.equal(weaponPreviewOptions('?weapon=vandal', false).weapon, 'vandal')
  assert.equal(weaponPreviewOptions('?weapon=sheriff', false).weapon, 'sheriff')
  assert.equal(weaponPreviewOptions('?weapon=judge', false).weapon, 'judge')
  assert.equal(weaponPreviewOptions('?candidate=candidate-sheriff&weapon=sheriff&version=v1&skin=smite', true).weapon, 'sheriff')
  assert.equal(weaponPreviewOptions('?candidate=candidate-ghost&weapon=ghost&version=v1&skin=freehand', true).weapon, 'ghost')
  assert.throws(() => weaponPreviewOptions(query, false), /development server/)
  assert.throws(() => weaponPreviewOptions('?weapon=unknown', true), /Unknown preview weapon/)
  assert.throws(() => weaponPreviewOptions('?candidate=..&version=v4&skin=ag', true), /Invalid candidate/)
  assert.throws(() => weaponPreviewOptions('?candidate=candidate-abc', true), /Invalid candidate/)
})

test('candidate middleware serves exact assets without caching; other URLs pass through', async (t) => {
  const f = await fixture(t)
  const url = '/__weapon_preview__/candidate-test/classic/v4/manifest.json'
  const result = await dispatch(f.middleware, url)
  assert.equal(result.body.toString(), '{"candidate":true}')
  assert.equal(result.headers['Content-Type'], 'application/json')
  assert.equal(result.headers['Cache-Control'], 'no-store')
  const head = await dispatch(f.middleware, url, { method: 'HEAD' })
  assert.equal(head.body, undefined)
  assert.ok(head.headers['Content-Length'] > 0)
  assert.equal((await dispatch(f.middleware, '/weapons/classic/v4/manifest.json')).next, true)
  assert.equal(weaponCandidatePlugin(f.root).apply, 'serve')
})

test('candidate middleware rejects traversal, authoring files, remote clients and cross-site reads', async (t) => {
  const f = await fixture(t)
  for (const relative of [
    'candidate-test/../secret.json',
    'candidate-test/%2e%2e/secret.json',
    'candidate-test/%5csecret.json',
    'candidate-test/F:/secret.json',
    'candidate-test/source.blend',
    'candidate-test/null%00.json',
  ]) {
    assert.equal((await dispatch(f.middleware, `/__weapon_preview__/${relative}`)).status, 403)
  }
  const url = '/__weapon_preview__/candidate-test/classic/v4/manifest.json'
  assert.equal((await dispatch(f.middleware, url, { address: '192.168.1.2' })).status, 403)
  assert.equal((await dispatch(f.middleware, url, {
    headers: { host: 'example.com' },
  })).status, 403)
  assert.equal((await dispatch(f.middleware, url, {
    headers: { origin: 'https://example.com' },
  })).status, 403)
  assert.equal((await dispatch(f.middleware, url, {
    headers: { 'sec-fetch-site': 'cross-site' },
  })).status, 403)
  assert.equal((await dispatch(f.middleware, url, { method: 'POST' })).status, 405)
  assert.equal((await dispatch(f.middleware, `${url}.png`)).status, 404)
  assert.equal((await dispatch(f.middleware, '/__weapon_preview__/candidate-test/%.json')).status, 400)
})

test('candidate middleware resolves junctions before checking the allowed root', async (t) => {
  const f = await fixture(t)
  const outside = path.join(f.directory, 'outside')
  await mkdir(outside)
  await writeFile(path.join(outside, 'secret.json'), 'private')
  await symlink(outside, path.join(f.root, 'candidate-escape'), 'junction')
  const result = await dispatch(f.middleware, '/__weapon_preview__/candidate-escape/secret.json')
  assert.equal(result.status, 403)
})
