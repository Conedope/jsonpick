import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../bin/jsonpick.js', import.meta.url));

function run(args, input) {
  return spawnSync(process.execPath, [BIN, ...args], { input, encoding: 'utf8' });
}

test('pretty-prints valid parsed JSON from stdin by default', () => {
  const r = run([], '{"a":1}');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '{\n  "a": 1\n}\n');
  assert.equal(r.stderr, '');
});

test('compact mode prints single-line JSON', () => {
  const r = run(['-c'], '{"a":1,"b":[1,2,3]}');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '{"a":1,"b":[1,2,3]}\n');
});

test('custom indent width', () => {
  const r = run(['-i', '4'], '{"a":1}');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '{\n    "a": 1\n}\n');
});

test('sort-keys sorts recursively', () => {
  const r = run(['-s'], '{"b":1,"a":{"d":2,"c":3}}');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '{\n  "a": {\n    "c": 3,\n    "d": 2\n  },\n  "b": 1\n}\n');
});

test('invalid JSON reports a parse error and exits 1', () => {
  const r = run([], '{bad');
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /^jsonpick: parse error at line 1, column \d+: .*/);
});

test('invalid JSON with a token error still reports position', () => {
  const r = run([], '{\n  "a": nope\n}');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^jsonpick: parse error at line 2, column \d+: .*/);
});

test('--validate exits 0 silently for valid JSON', () => {
  const r = run(['--validate'], '{"ok":true}');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
});

test('--validate exits 1 for invalid JSON', () => {
  const r = run(['--validate'], '{broken');
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /^jsonpick: parse error at line 1, column \d+/);
});

test('--path selects a value', () => {
  const r = run(['-p', 'a.b[1]'], '{"a":{"b":[1,2,3]}}');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '2\n');
});

test('--path on a missing key prints nothing and exits 0', () => {
  const r = run(['-p', 'nope'], '{"a":1}');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('--path with --compact', () => {
  const r = run(['-p', 'items[?score>4]', '-c'], '{"items":[{"score":5},{"score":2}]}');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '[{"score":5}]\n');
});

test('--path with recursive descent', () => {
  const r = run(['-p', '..name', '-c'], '{"a":{"name":"x","sub":{"name":"y"}},"name":"root"}');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '["x","y","root"]\n');
});

test('--paths prints each value on its own line', () => {
  const r = run(['--json', '{"a":1,"b":2}', '-a', 'a', 'b']);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '1\n2\n');
});

test('--paths skips selections that find nothing', () => {
  const r = run(['--json', '{"a":1,"b":2}', '-a', 'a', 'missing', 'b']);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '1\n2\n');
});

test('--paths with an object result is compact and on one line', () => {
  const r = run(['--json', '{"a":{"x":1},"b":[1,2]}', '-a', 'a', 'b']);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '{"x":1}\n[1,2]\n');
});

test('--typeof prints the value type', () => {
  assert.equal(run(['-t', '-p', 'a'], '{"a":[1,2]}').stdout, 'array\n');
  assert.equal(run(['-t', '-p', 'a'], '{"a":3}').stdout, 'number\n');
  assert.equal(run(['-t', '-p', 'a'], '{"a":"x"}').stdout, 'string\n');
  assert.equal(run(['-t', '-p', 'a'], '{"a":true}').stdout, 'boolean\n');
  assert.equal(run(['-t', '-p', 'a'], '{"a":null}').stdout, 'null\n');
  assert.equal(run(['-t', '-p', 'a'], '{"a":{}}').stdout, 'object\n');
});

test('--typeof on a missing path prints undefined', () => {
  const r = run(['-t', '-p', 'missing'], '{"a":1}');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, 'undefined\n');
});

test('--typeof with a recursive descent path', () => {
  const r = run(['-t', '-p', '..x'], '{"x":1}');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, 'array\n');
});

test('invalid path syntax exits 1 with a message', () => {
  const r = run(['-p', 'a['], '{}');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^jsonpick: invalid path 'a\[': .+/);
});

test('missing input file exits 2', () => {
  const r = run(['/no/such/file.json']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /^jsonpick: cannot read '\/no\/such\/file\.json': .+/);
});

test('explicit stdin marker -', () => {
  const r = run(['-'], '{"a":1}');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '{\n  "a": 1\n}\n');
});

test('--json supplies the document directly', () => {
  const r = run(['--json', '{"a":5}', '-c']);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '{"a":5}\n');
});

test('file input via a real path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jsonpick-'));
  const file = join(dir, 'doc.json');
  writeFileSync(file, '{"a":{"b":[10,20,30]}}');
  try {
    const r = run([file, '-p', 'a.b[1]']);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '20\n');
    const r2 = run(['-c', file]);
    assert.equal(r2.status, 0);
    assert.equal(r2.stdout, '{"a":{"b":[10,20,30]}}\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--version prints the version', () => {
  const r = run(['--version']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^\d+\.\d+\.\d+\n$/);
});

test('--help prints usage', () => {
  const r = run(['--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /jsonpick \d+\.\d+\.\d+[\s\S]*Usage:/);
  assert.match(r.stdout, /Exit codes:/);
});

test('unknown option is a usage error', () => {
  const r = run(['--nope'], '{}');
  assert.equal(r.status, 3);
  assert.match(r.stderr, /jsonpick: unknown option '--nope'/);
});

test('empty input is a parse error', () => {
  const r = run([], '');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^jsonpick: parse error at line 1, column 1: unexpected end of JSON input/);
});