#!/usr/bin/env node
// jsonpick -- a jq-inspired JSON query CLI with zero dependencies.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { selectPath } from '../lib/path.js';
import { pretty, compact, sortKeysRecursively } from '../lib/format.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');
const VERSION = pkg.version;

const HELP = `jsonpick ${VERSION} - a jq-inspired JSON query tool (zero dependencies)

Usage:
  jsonpick [options] [input]

Input is read from FILE, from '-' (stdin), or from stdin when omitted.
You can also pass the document directly with --json '{"a":1}'.

Actions:
  (default)           pretty-print the parsed document
  -p, --path P        select a single path and print the resulting value
  -a, --paths P...    select several paths; each value printed on its own line
  --validate          parse only: exit 0 if valid, 1 if invalid (prints nothing on success)

Options:
  -c, --compact       print compact (single-line) JSON
  -s, --sort-keys     sort object keys recursively before printing
  -i, --indent N      indentation width for pretty output (default 2)
  -t, --typeof        print the type of each selected value instead of the value
  -v, --version       print the version and exit
  -h, --help          show this help

Path DSL:
  a.b.c               dot access
  a["my key"]         quoted key
  a[0]  a[-1]         array index (negative counts from the end)
  a[*]                every element of an array (result is an array)
  ..key               recursive descent: every value stored under 'key'
  a[?score>4]         filter: operators > < >= <= == != vs a number,
                      or == / != vs a single-quoted string, e.g. a[?name=='bob']

Exit codes:
  0  success (including valid --validate and selections that find nothing)
  1  invalid JSON, or an invalid path
  2  input file missing or unreadable
  3  usage error (unknown option, bad argument)
`;

// ---- argument parsing -------------------------------------------------------

function parseArgs(argv) {
  const cfg = {
    json: null,
    input: '-',
    paths: [],
    indent: 2,
    indentExplicit: false,
    compact: false,
    sortKeys: false,
    validate: false,
    typeOnly: false,
    version: false,
    help: false,
  };
  const positionals = [];

  const pushError = (msg) => ({ config: cfg, error: msg });

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      for (let k = i + 1; k < argv.length; k++) positionals.push(argv[k]);
      break;
    }
    if (a === '-') {
      positionals.push(a);
      continue;
    }
    if (!a.startsWith('-')) {
      positionals.push(a);
      continue;
    }

    const take = () => (i + 1 < argv.length ? argv[++i] : null);

    if (a === '-h' || a === '--help') {
      cfg.help = true;
    } else if (a === '-v' || a === '--version') {
      cfg.version = true;
    } else if (a === '-c' || a === '--compact') {
      cfg.compact = true;
    } else if (a === '-s' || a === '--sort-keys') {
      cfg.sortKeys = true;
    } else if (a === '--validate') {
      cfg.validate = true;
    } else if (a === '-t' || a === '--typeof') {
      cfg.typeOnly = true;
    } else if (a === '-p' || a === '--path' || a.startsWith('--path=')) {
      const v = a.startsWith('--path=') ? a.slice('--path='.length) : take();
      if (v === null) return pushError('--path requires a value');
      cfg.paths.push(v);
    } else if (a === '-a' || a === '--paths' || a.startsWith('--paths=')) {
      if (a.startsWith('--paths=')) {
        cfg.paths.push(a.slice('--paths='.length));
      } else {
        while (i + 1 < argv.length && argv[i + 1] !== '--' && !(argv[i + 1].startsWith('-') && argv[i + 1].length > 1)) {
          cfg.paths.push(argv[++i]);
        }
      }
    } else if (a === '-i' || a === '--indent' || a.startsWith('--indent=')) {
      const v = a.startsWith('--indent=') ? a.slice('--indent='.length) : take();
      if (v === null || !/^\d+$/.test(v)) return pushError('--indent requires a non-negative integer');
      cfg.indent = parseInt(v, 10);
      cfg.indentExplicit = true;
    } else if (a === '--json' || a.startsWith('--json=')) {
      const v = a.startsWith('--json=') ? a.slice('--json='.length) : take();
      if (v === null) return pushError('--json requires a value');
      cfg.json = v;
    } else {
      return pushError(`unknown option '${a}'`);
    }
  }

  if (positionals.length > 1) {
    return pushError(`unexpected extra argument '${positionals[1]}' (provide input as a single file, '-', or stdin)`);
  }
  cfg.input = positionals[0] !== undefined ? positionals[0] : '-';
  return { config: cfg, error: null };
}

// ---- helpers ----------------------------------------------------------------

// Structural JSON scanner used to locate errors precisely when V8's JSON.parse
// error message carries no position (e.g. "Unexpected token 'o', ... is not
// valid JSON"). Returns the index of the first problem, or -1 if the text is
// accepted by the scanner (mirrors the JSON grammar closely).
function firstErrorPosition(text) {
  const n = text.length;
  let i = 0;
  const MAX_DEPTH = 2000;

  const ws = () => {
    while (i < n && (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r')) i++;
  };

  const parseValue = (depth) => {
    if (depth > MAX_DEPTH) return Math.min(i, n);
    ws();
    if (i >= n) return n;
    const c = text[i];
    if (c === '{') return parseObject(depth + 1);
    if (c === '[') return parseArray(depth + 1);
    if (c === '"') return parseString();
    if (c === '-' || (c >= '0' && c <= '9')) return parseNumber();
    if (text.startsWith('true', i) && i + 4 <= n) {
      i += 4;
      return null;
    }
    if (text.startsWith('false', i) && i + 5 <= n) {
      i += 5;
      return null;
    }
    if (text.startsWith('null', i) && i + 4 <= n) {
      i += 4;
      return null;
    }
    return i;
  };

  const parseString = () => {
    i++; // opening quote
    while (i < n) {
      const c = text[i];
      if (c === '"') {
        i++;
        return null;
      }
      if (c === '\\') {
        i++;
        if (i >= n) return n;
        const e = text[i];
        if (e === '"' || e === '\\' || e === '/' || e === 'b' || e === 'f' || e === 'n' || e === 'r' || e === 't') {
          i++;
          continue;
        }
        if (e === 'u') {
          if (!/^[0-9a-fA-F]{4}/.test(text.slice(i + 1, i + 5))) return i + 1;
          i += 5;
          continue;
        }
        return i;
      }
      if (c === '\n' || c === '\r') return i; // unescaped control character
      i++;
    }
    return n; // unterminated string
  };

  const parseNumber = () => {
    let j = i;
    if (text[j] === '-') j++;
    if (j >= n) return n;
    if (text[j] === '0') {
      j++;
    } else if (text[j] >= '1' && text[j] <= '9') {
      while (j < n && text[j] >= '0' && text[j] <= '9') j++;
    } else {
      return i;
    }
    if (text[j] === '.') {
      j++;
      if (j >= n || !(text[j] >= '0' && text[j] <= '9')) return j;
      while (j < n && text[j] >= '0' && text[j] <= '9') j++;
    }
    if (text[j] === 'e' || text[j] === 'E') {
      j++;
      if (text[j] === '+' || text[j] === '-') j++;
      if (j >= n || !(text[j] >= '0' && text[j] <= '9')) return j;
      while (j < n && text[j] >= '0' && text[j] <= '9') j++;
    }
    i = j;
    return null;
  };

  const parseObject = (depth) => {
    i++; // {
    ws();
    if (i < n && text[i] === '}') {
      i++;
      return null;
    }
    for (;;) {
      ws();
      if (i >= n) return n;
      if (text[i] !== '"') return i;
      const s = parseString();
      if (s !== null) return s;
      ws();
      if (i >= n || text[i] !== ':') return i >= n ? n : i;
      i++;
      const v = parseValue(depth);
      if (v !== null) return v;
      ws();
      if (i >= n) return n;
      if (text[i] === ',') {
        i++;
        continue;
      }
      if (text[i] === '}') {
        i++;
        return null;
      }
      return i;
    }
  };

  const parseArray = (depth) => {
    i++; // [
    ws();
    if (i < n && text[i] === ']') {
      i++;
      return null;
    }
    for (;;) {
      const v = parseValue(depth);
      if (v !== null) return v;
      ws();
      if (i >= n) return n;
      if (text[i] === ',') {
        i++;
        continue;
      }
      if (text[i] === ']') {
        i++;
        return null;
      }
      return i;
    }
  };

  const top = parseValue(0);
  if (top !== null) return top;
  ws();
  if (i < n) return i; // trailing garbage
  return -1;
}

// Human-readable reason for an error at `pos` in `text`.
function scanReason(text, pos) {
  if (pos >= text.length) return 'unexpected end of JSON input';
  const c = text[pos];
  if (c === '\n' || c === '\r') return 'unescaped control character in string';
  return `unexpected token '${c}'`;
}

function lineCol(text, pos) {
  pos = Math.max(0, Math.min(text.length, pos || 0));
  const before = text.slice(0, pos);
  const lines = before.split('\n');
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

function positionOfError(err, text) {
  const m = /at position (\d+)/.exec(String(err && err.message));
  if (m) return parseInt(m[1], 10);
  const line = /line (\d+)/.exec(String(err && err.message));
  if (line) {
    const ln = parseInt(line[1], 10);
    const col = /column (\d+)/.exec(String(err && err.message));
    const lines = text.split('\n');
    return lines.slice(0, ln - 1).reduce((acc, l) => acc + l.length + 1, 0) + (col ? parseInt(col[1], 10) - 1 : 0);
  }
  return -1;
}

function typeName(v) {
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

// ---- main -------------------------------------------------------------------

function main() {
  const { config: cfg, error } = parseArgs(process.argv.slice(2));
  if (error) {
    process.stderr.write(`jsonpick: ${error}\n\n${HELP}`);
    return 3;
  }
  if (cfg.help) {
    process.stdout.write(`${HELP}`);
    return 0;
  }
  if (cfg.version) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (cfg.json && cfg.input !== '-') {
    process.stderr.write(`jsonpick: --json cannot be combined with a file argument\n`);
    return 3;
  }
  if (cfg.typeOnly && cfg.paths.length === 0) {
    process.stderr.write('jsonpick: --typeof requires a selection with --path or --paths\n');
    return 3;
  }

  let text;
  if (cfg.json !== null) {
    text = cfg.json;
  } else if (cfg.input === '-') {
    try {
      text = readFileSync(0, 'utf8');
    } catch (err) {
      process.stderr.write(`jsonpick: cannot read stdin: ${err.message}\n`);
      return 2;
    }
  } else {
    try {
      text = readFileSync(cfg.input, 'utf8');
    } catch (err) {
      process.stderr.write(`jsonpick: cannot read '${cfg.input}': ${err.message}\n`);
      return 2;
    }
  }

  let doc;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    let pos = positionOfError(err, text);
    let message = err.message;
    if (pos < 0) {
      pos = firstErrorPosition(text);
      if (pos === -1) pos = 0;
      message = scanReason(text, pos);
    }
    const { line, column } = lineCol(text, pos);
    process.stderr.write(`jsonpick: parse error at line ${line}, column ${column}: ${message}\n`);
    return 1;
  }

  if (cfg.validate) return 0;

  const multiCompact = cfg.paths.length > 1 && !cfg.indentExplicit && !cfg.compact;
  const formatValue = (v) => (cfg.compact || multiCompact ? compact(v) : pretty(v, cfg.indent));
  const maybeSort = (v) => (cfg.sortKeys ? sortKeysRecursively(v) : v);

  if (cfg.paths.length === 0) {
    process.stdout.write(`${formatValue(maybeSort(doc))}\n`);
    return 0;
  }

  for (const p of cfg.paths) {
    const res = selectPath(p, doc);
    if (!res.ok) {
      process.stderr.write(`jsonpick: invalid path '${p}': ${res.error}\n`);
      return 1;
    }
    const value = res.value;
    if (cfg.typeOnly) {
      process.stdout.write(`${typeName(value)}\n`);
      continue;
    }
    if (value === undefined) continue; // selection found nothing: print nothing, exit 0
    process.stdout.write(`${formatValue(maybeSort(value))}\n`);
  }
  return 0;
}

process.exit(main());