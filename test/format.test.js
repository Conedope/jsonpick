import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pretty, compact, sortKeysRecursively } from '../lib/format.js';

test('pretty prints with 2-space indentation', () => {
  assert.equal(pretty({ a: 1, b: [1, 2] }), '{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}');
});

test('pretty honors a custom indent width', () => {
  assert.equal(pretty({ a: 1 }, 4), '{\n    "a": 1\n}');
});

test('pretty keeps nested structure', () => {
  const out = pretty({ x: { y: { z: [true, null] } } }, 2);
  assert.equal(JSON.parse(out).x.y.z[0], true);
  assert.equal(JSON.parse(out).x.y.z[1], null);
});

test('compact prints a single line', () => {
  assert.equal(compact({ a: 1, b: [1, 2], c: null, d: true }), '{"a":1,"b":[1,2],"c":null,"d":true}');
});

test('compact escapes strings exactly like JSON', () => {
  assert.equal(compact({ s: 'a\nb\t"q"\\' }), '{"s":"a\\nb\\t\\"q\\"\\\\"}');
});

test('unicode is preserved, not escaped', () => {
  assert.equal(compact({ emoji: '👋', accent: 'café', jp: '日本語' }), '{"emoji":"👋","accent":"café","jp":"日本語"}');
});

test('escape sequences round-trip through compact', () => {
  const doc = { s: 'line\nbreak\ttab\n\\backslash\n"dquote"\n\u00e9\u4e2d', arr: [1, { x: '\n' }] };
  assert.deepEqual(JSON.parse(compact(doc)), doc);
});

test('pretty output round-trips', () => {
  const doc = { u: '👋', s: 'a\nb', n: null, arr: [1, { k: 'v' }] };
  assert.deepEqual(JSON.parse(pretty(doc, 2)), doc);
});

test('sortKeysRecursively sorts object keys and keeps arrays stable', () => {
  const out = sortKeysRecursively({ z: { b: 1, a: 2 }, a: [{ d: 1, c: 2 }, 3] });
  assert.deepEqual(Object.keys(out), ['a', 'z']);
  assert.deepEqual(Object.keys(out.z), ['a', 'b']);
  assert.deepEqual(Object.keys(out.a[0]), ['c', 'd']);
  assert.equal(out.a[1], 3);
  assert.deepEqual(out.a.length, 2);
});

test('sortKeysRecursively sorts nested and array-of-object keys', () => {
  const doc = { b: [{ d: 1, c: 2 }, { g: 1, f: { i: 1, h: 2 } }], a: 1 };
  assert.deepEqual(sortKeysRecursively(doc), {
    a: 1,
    b: [{ c: 2, d: 1 }, { f: { h: 2, i: 1 }, g: 1 }],
  });
});

test('sortKeysRecursively leaves scalars untouched', () => {
  assert.equal(sortKeysRecursively(42), 42);
  assert.equal(sortKeysRecursively(null), null);
  assert.equal(sortKeysRecursively('x'), 'x');
  assert.equal(sortKeysRecursively(true), true);
});

test('sortKeysRecursively does not mutate the input', () => {
  const doc = { b: 1, a: 2 };
  const out = sortKeysRecursively(doc);
  assert.deepEqual(Object.keys(doc), ['b', 'a']);
  assert.deepEqual(Object.keys(out), ['a', 'b']);
});