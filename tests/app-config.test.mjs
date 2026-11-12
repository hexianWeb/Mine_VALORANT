import assert from 'node:assert/strict'
import test from 'node:test'
import { readAppConfig } from '../src/app/config.js'
import { inputBindings } from '../src/configs/input-bindings.js'

test('application config supplies the game bindings from configs', () => {
  const options = readAppConfig('')
  assert.equal(options.inputBindings, inputBindings)
})

test('weapon controls reserve R for reload and Home for respawn', () => {
  for (const [code, action] of Object.entries({
    Mouse0: 'fire',
    Mouse2: 'aim',
    WheelUp: 'previousWeapon',
    WheelDown: 'nextWeapon',
    KeyR: 'reload',
    Home: 'respawn',
    KeyT: 'inspect',
    KeyK: 'cycleSkin',
    Digit1: 'primaryWeapon',
    Digit2: 'secondaryWeapon',
    KeyQ: 'previousEquipped',
  })) assert.equal(inputBindings[code], action)
})
