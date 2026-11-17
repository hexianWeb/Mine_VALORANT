import assert from 'node:assert/strict'
import test from 'node:test'
import { bindSensitivityStorage, sensitivityStorageKey } from '../src/app/sensitivity-storage.js'
import { createLookSettings, sensitivityLimits } from '../src/game/player/look-settings.js'

test('sensitivity validates bounds, coalesces requests, and commits without floating point drift', () => {
  const settings = createLookSettings()
  assert.equal(settings.read().sensitivity, 0.4)
  for (const value of [
    NaN,
    Infinity,
    -1,
    0,
    0.009,
    5.001,
    '0.4',
    null,
  ])
    assert.equal(settings.request(value), false)
  assert.equal(settings.request(0.4 + sensitivityLimits.fine), true)
  settings.request(0.4 + sensitivityLimits.coarse)
  assert.deepEqual({
    ...settings.read(),
  }, {
    sensitivity: 0.4,
    requested: 0.5,
    pending: true,
    revision: 2,
  })
  settings.commit()
  assert.equal(settings.read().sensitivity, 0.5)
  const current = settings.read()
  settings.commit()
  assert.equal(settings.read(), current, 'unchanged settings reuse their read model')
  settings.request(0.01)
  settings.commit()
  assert.equal(settings.read().sensitivity, 0.01)
  settings.request(5)
  settings.commit()
  assert.equal(settings.read().sensitivity, 5)
  assert.ok(Object.isFrozen(settings.read()))
  settings.dispose()
  assert.equal(settings.request(1), false)
})

test('local storage restores valid values, writes only committed changes, and detaches', () => {
  const settings = createLookSettings()
  const writes = []
  const binding = bindSensitivityStorage({
    settings,
    getStorage: () => ({
      getItem: key => key === sensitivityStorageKey
        ? '0.72'
        : null,
      setItem: (...args) => writes.push(args),
    }),
  })
  assert.equal(settings.read().sensitivity, 0.4)
  assert.equal(settings.read().requested, 0.72)
  settings.commit()
  assert.deepEqual(writes, [], 'restoring a valid value need not rewrite storage')
  settings.request(0.73)
  assert.deepEqual(writes, [])
  settings.commit()
  assert.deepEqual(writes, [
    [sensitivityStorageKey, '0.73'],
  ])
  binding.dispose()
  settings.request(1)
  settings.commit()
  assert.equal(writes.length, 1)
})

test('invalid data and unavailable storage cannot poison player settings or block changes', () => {
  for (const raw of [
    null,
    '',
    ' ',
    'NaN',
    'Infinity',
    '-1',
    '0',
    '5.01',
    '{}',
  ]) {
    const settings = createLookSettings()
    const binding = bindSensitivityStorage({
      settings,
      getStorage: () => ({
        getItem: () => raw,
      }),
    })
    assert.equal(settings.read().requested, 0.4, String(raw))
    binding.dispose()
  }
  for (const getStorage of [
    () => { throw new Error('denied') },
    () => ({
      getItem: () => null,
      setItem() { throw new Error('quota') },
    }),
  ]) {
    const settings = createLookSettings()
    const binding = bindSensitivityStorage({ settings, getStorage })
    settings.request(1)
    settings.commit()
    assert.equal(settings.read().sensitivity, 1)
    assert.equal(binding.read(), 'unavailable')
    binding.dispose()
  }
})
