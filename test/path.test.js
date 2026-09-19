import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePath, evaluate, selectPath } from '../lib/path.js';

const doc = {
  a: {
    'my key': 1,
    'slash\\key': 7,
    b: { c: 42 },
    list: [10, 20, 30],
  },
  items: [
    { score: 5, name: 'bob', tags: ['x'] },
    { score: 3, name: 'ann' },
    { score: 7, name: 'bob' },
    'nope',
    9,
    null,
    { score: 'high' },
  ],
};

test('dot access returns the value', () => {
  assert.equal(selectPath('a.b.c', doc).value, 42);
});

test('dot access through multiple hops', () => {
  assert.equal(selectPath('a.list', doc).value.length, 3);
});

test('quoted key access', () => {
  assert.equal(selectPath('a["my key"]', doc).value, 1);
});

test('quoted key with escaped characters', () => {
  assert.equal(selectPath('a["slash\\\\key"]', doc).value, 7);
});

test('array index', () => {
  assert.equal(selectPath('a.list[0]', doc).value, 10);
  assert.equal(selectPath('a.list[2]', doc).value, 30);
});

test('negative array index counts from the end', () => {
  assert.equal(selectPath('a.list[-1]', doc).value, 30);
  assert.equal(selectPath('a.list[-3]', doc).value, 10);
});

test('index followed by chained segment', () => {
  assert.equal(selectPath('items[1].score', doc).value, 3);
});

test('index on non-array yields undefined', () => {
  assert.equal(selectPath('a.b[0]', doc).value, undefined);
});

test('out-of-range index yields undefined', () => {
  assert.equal(selectPath('a.list[99]', doc).value, undefined);
  assert.equal(selectPath('a.list[-99]', doc).value, undefined);
});

test('wildcard returns an array of elements', () => {
  assert.deepEqual(selectPath('a.list[*]', doc).value, [10, 20, 30]);
});

test('wildcard chained with a key maps over elements', () => {
  assert.deepEqual(selectPath('items[*].name', doc).value, ['bob', 'ann', 'bob']);
});

test('wildcard on non-array yields undefined', () => {
  assert.equal(selectPath('a.b[*]', doc).value, undefined);
});

test('missing key yields undefined', () => {
  assert.equal(selectPath('does.not.exist', doc).value, undefined);
  assert.equal(selectPath('a.b.c.d', doc).value, undefined);
});

test('recursive descent collects every matching value', () => {
  const nested = { name: 'root', deep: { nested: { name: 'kid' }, name: 'mid' } };
  assert.deepEqual(selectPath('..name', nested).value, ['root', 'kid', 'mid']);
});

test('recursive descent from a subpath', () => {
  const nested = { x: { name: 'one', inner: { name: 'two' } }, name: 'root' };
  assert.deepEqual(selectPath('x..name', nested).value, ['one', 'two']);
});

test('recursive descent through arrays', () => {
  const nested = { list: [{ name: 'a' }, { name: 'b' }], name: 'c' };
  assert.deepEqual(selectPath('..name', nested).value, ['a', 'b', 'c']);
});

test('recursive descent with no matches yields undefined', () => {
  assert.equal(selectPath('..zzz', { a: { b: 1 } }).value, undefined);
});

test('recursive descent can be combined with index', () => {
  const nested = { list: [1, 2], other: { list: [3] } };
  assert.deepEqual(selectPath('..list[0]', nested).value, [1, 3]);
});

test('filter: greater than', () => {
  assert.deepEqual(selectPath('items[?score>4]', doc).value, [
    { score: 5, name: 'bob', tags: ['x'] },
    { score: 7, name: 'bob' },
  ]);
});

test('filter: greater than or equal', () => {
  const value = selectPath('items[?score>=5]', doc).value;
  assert.deepEqual(value.map((v) => v.score), [5, 7]);
});

test('filter: less than', () => {
  assert.deepEqual(selectPath('items[?score<4]', doc).value, [{ score: 3, name: 'ann' }]);
});

test('filter: less than or equal', () => {
  assert.deepEqual(selectPath('items[?score<=3]', doc).value, [{ score: 3, name: 'ann' }]);
});

test('filter: equal (number)', () => {
  assert.deepEqual(selectPath('items[?score==5]', doc).value, [{ score: 5, name: 'bob', tags: ['x'] }]);
});

test('filter: not equal (number)', () => {
  assert.deepEqual(selectPath('items[?score!=5]', doc).value, [
    { score: 3, name: 'ann' },
    { score: 7, name: 'bob' },
  ]);
});

test('filter: decimal comparison', () => {
  assert.deepEqual(selectPath('items[?score>2.5]', doc).value.map((v) => v.score), [5, 3, 7]);
});

test('filter: equal (string)', () => {
  const value = selectPath("items[?name=='bob']", doc).value;
  assert.deepEqual(value.map((v) => v.name), ['bob', 'bob']);
});

test('filter: not equal (string)', () => {
  assert.deepEqual(selectPath("items[?name!='bob']", doc).value, [{ score: 3, name: 'ann' }]);
});

test('filter: string reference matches string values', () => {
  assert.deepEqual(selectPath("items[?score=='high']", doc).value, [{ score: 'high' }]);
});

test('filter: ordering operators against strings never match', () => {
  assert.equal(selectPath("items[?name>'a']", doc).value, undefined);
});

test('filter: elements without the key are skipped', () => {
  assert.equal(selectPath('items[?score>4]', doc).value.length, 2);
  assert.equal(selectPath('items[?noSuchKey>4]', doc).value, undefined);
});

test('filter: non-object elements are skipped', () => {
  const value = selectPath('items[?score>=3]', doc).value;
  assert.equal(value.length, 3);
  for (const v of value) assert.equal(typeof v, 'object');
});

test('filter on a non-array yields undefined', () => {
  const fl = { score: 9 };
  assert.equal(selectPath('items[?x>1]', { items: fl }).value, undefined);
});

test('result shape is { ok, value, error? }', () => {
  const ok = selectPath('a.b.c', doc);
  assert.deepEqual(Object.keys(ok).sort(), ['error', 'ok', 'value']);
  assert.equal(ok.ok, true);
  assert.equal(ok.error, undefined);
  const missing = selectPath('nope', doc);
  assert.equal(missing.ok, true);
  assert.equal(missing.value, undefined);
});

test('parse errors return ok:false with a message', () => {
  for (const bad of ['a[', '[', 'a[abc]', 'a["unterminated]', 'a..', 'a...', '..', 'a[?x]', 'a[?x>>1]', 'a[?score>]', 'a[1]b', '']) {
    const r = selectPath(bad, doc);
    assert.equal(r.ok, false, `expected parse failure for ${JSON.stringify(bad)}`);
    assert.equal(typeof r.error, 'string', `expected error message for ${JSON.stringify(bad)}`);
    assert.ok(r.error.length > 0);
  }
});

test('parsePath returns ok:true for valid paths', () => {
  for (const good of [
    'a.b.c',
    'a["k"]',
    'a[0]',
    'a[*]',
    'a[?x>4]',
    'a[?x >= 4]',
    '..key',
    '.a',
    'a..b',
  ]) {
    const r = parsePath(good);
    assert.equal(r.ok, true, `expected parse success for ${JSON.stringify(good)}`);
  }
});

test('evaluate works on parsed segments directly', () => {
  const parsed = parsePath('a.list[1]');
  assert.equal(parsed.ok, true);
  assert.equal(evaluate(parsed.segments, doc).value, 20);
});

test('leading single dot behaves like a plain key', () => {
  assert.equal(selectPath('.a.b.c', doc).value, 42);
});

test('bracket-only path from the root', () => {
  assert.equal(selectPath('["a"].b.c', doc).value, 42);
  assert.equal(selectPath('[0]', [10, 20]).value, 10);
});

test('multi-selector that matches nothing is undefined, not empty array', () => {
  assert.equal(selectPath('items[*].tags[99]', doc).value, undefined);
});