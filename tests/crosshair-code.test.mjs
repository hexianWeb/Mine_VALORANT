import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultCrosshairProfile, parseCrosshairCode } from '../src/app/crosshair-code.js'
import { crosshairRects } from '../src/app/crosshair-renderer.js'

const example = '0;s;1;P;h;0;0l;3;0o;1;0f;0;1b;0;S;o;1'

test('the reference code uses white 3/2/1 inner lines and inherits the primary aim style', () => {
  const profile = parseCrosshairCode(`  ${example};\n`)
  assert.equal(profile.advanced, true)
  assert.equal(profile.primary.color, '#ffffff')
  assert.equal(profile.primary.dot, null)
  assert.equal(profile.primary.outline, null)
  assert.equal(profile.primary.outer, null)
  assert.deepEqual(profile.primary.inner, {
    length: 3,
    verticalLength: 3,
    thickness: 2,
    offset: 1,
    opacity: 0.8,
    movementScale: 0,
    firingScale: 0,
  })
  assert.equal(profile.ads, profile.primary)
  assert.equal(profile.sniper.dot.opacity, 1)
  assert.deepEqual(profile.extraFields, [])
  assert.equal(defaultCrosshairProfile.primary.color, '#27eae0')
})

test('fields use their section defaults and support independent ADS and sniper settings', () => {
  const profile = parseCrosshairCode('0;s;1;p;0;P;c;8;u;1FADC8CC;b;1;o;0.3;d;1;z;3;0l;5;0g;1;0v;3;0m;1;0s;.4;A;c;7;h;0;0t;1;S;c;8;t;C0D1C4FF;s;0.8;o;0.65')
  assert.equal(profile.primary.color, '#1fadc8cc')
  assert.equal(profile.primary.inner.length, 5)
  assert.equal(profile.primary.inner.verticalLength, 3)
  assert.equal(profile.primary.inner.movementScale, 0.4)
  assert.equal(profile.primary.outline.opacity, 0.3)
  assert.equal(profile.primary.dot.size, 3)
  assert.equal(profile.ads.color, '#ff0000')
  assert.equal(profile.ads.inner.thickness, 1)
  assert.equal(profile.ads.outline, null)
  assert.deepEqual(profile.sniper, {
    color: '#c0d1c4ff',
    dot: { size: 0.8, opacity: 0.65 },
  })
  assert.deepEqual(profile.extraFields, [])
})

test('additional fields stay local to their section and consume their value', () => {
  const profile = parseCrosshairCode('0;P;future;S;o;0.4;S;o;1')
  assert.deepEqual(profile.extraFields, ['P.future'])
  assert.equal(profile.primary.outline.opacity, 0.4)
  assert.equal(profile.sniper.dot.opacity, 1)
})

test('invalid syntax, ranges and custom colors fail before there is a draft to apply', () => {
  for (const code of [
    '',
    '1;P;0l;3',
    '0;P;0l',
    '0;P;h;0.5',
    '0;A;0l;21',
    '0;P;c;8;u;FFFF',
    '0;S;o;NaN',
  ]) {
    assert.throws(() => parseCrosshairCode(code), SyntaxError, code)
  }
})

test('the imported 3/2/1 geometry stays on the integer device-pixel grid', () => {
  const { primary } = parseCrosshairCode(example)
  assert.deepEqual(crosshairRects(primary, 1280, 720, 1), [
    [636, 359, 3, 2, 0.8],
    [641, 359, 3, 2, 0.8],
    [639, 356, 2, 3, 0.8],
    [639, 361, 2, 3, 0.8],
  ])
  assert.deepEqual(crosshairRects(primary, 1706, 959, 1.25, { movement: 10, firing: 10 }), [
    [848, 478, 4, 3, 0.8],
    [855, 478, 4, 3, 0.8],
    [852, 474, 3, 4, 0.8],
    [852, 481, 3, 4, 0.8],
  ])
})

test('movement and firing multipliers affect each visible line group independently', () => {
  const { primary } = parseCrosshairCode('0;P;h;0;0l;3;0o;1;0m;1;0s;.5;0e;.5;1b;0')
  const [left, right] = crosshairRects(primary, 1280, 720, 1, { movement: 8, firing: 4 })
  assert.equal(right[0] - (left[0] + left[2]), 14)
})
