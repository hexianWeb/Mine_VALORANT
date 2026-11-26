import assert from 'node:assert/strict'
import test from 'node:test'
import { readAppConfig } from '../src/app/config.js'
import { inputBindings } from '../src/configs/input-bindings.js'

test('application config supplies gameplay bindings and opts into the fixed reference camera', () => {
  const options = readAppConfig('')
  assert.equal(options.inputBindings, inputBindings)
  assert.equal(options.referenceCamera, false)
  assert.equal(readAppConfig('?player=0&editor=0').referenceCamera, true)
})

test('primary touch pointers get the touch HUD by default; hybrid devices can override controls and editor independently', () => {
  const mobile = readAppConfig('', true)
  assert.equal(mobile.touchControls, true)
  assert.equal(mobile.editor, false)
  assert.equal(readAppConfig('', false).touchControls, false)
  assert.equal(readAppConfig('', false).editor, true)
  assert.equal(readAppConfig('?controls=mouse', true).touchControls, false)
  const preview = readAppConfig('?controls=touch&editor=1', false)
  assert.equal(preview.touchControls, true)
  assert.equal(preview.editor, true)
})

test('the hall reflection preview is opt-in', () => {
  assert.equal(readAppConfig('').level.reflectionPreview, false)
  const preview = readAppConfig('?reflectionPreview=1')
  assert.equal(preview.level.reflectionPreview, true)
  assert.equal(readAppConfig('?reflectionPreview=0').level.reflectionPreview, false)
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
    Digit3: 'tertiaryWeapon',
    Digit4: 'quaternaryWeapon',
    Digit5: 'quinaryWeapon',
    Digit6: 'senaryWeapon',
    Digit7: 'septenaryWeapon',
    KeyQ: 'previousEquipped',
  })) assert.equal(inputBindings[code], action)
})
