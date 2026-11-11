import assert from 'node:assert/strict'
import test from 'node:test'
import { readAppConfig } from '../src/app/config.js'
import { inputBindings } from '../src/configs/input-bindings.js'

test('application config supplies the game bindings from configs', () => {
  const options = readAppConfig('')
  assert.equal(options.inputBindings, inputBindings)
})
