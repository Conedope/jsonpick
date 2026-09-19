// lib/path.js -- JSON path evaluator for jsonpick.
//
// Path DSL (jq-inspired, deliberately small):
//
//   a.b.c                  dot access through object keys
//   a["my key"]            quoted object key (double quotes, JSON escapes)
//   a[0]                   array index (non-negative)
//   a[-1]                  array index from the end
//   a[*]                   every element of an array (yields an array)
//   ..key                  recursive descent: every value stored under `key`
//   a[?score>4]            filter an array by a predicate on each element's key
//
// Filter operators:  >  <  >=  <=  ==  !=
//   against numbers (e.g. ?score>4,  ?score>=4.5,  ?score==4),
//   or against single-quoted strings (e.g. ?name=='bob',  ?name!='bob').
//
// Semantics:
//   - A missing key, an out-of-range index, or a wildcard/filter applied to a
//     non-array all produce NO matches. If the whole path ends with no match,
//     the result is `undefined` (the CLI prints nothing and exits 0).
//   - A path containing `[*]`, a filter, or `..` is a "multi" path: its result
//     is always an array of matches, or `undefined` when nothing matched.
//   - Every API function returns { ok, value, error? }.

const OP_CHARS = new Set(['>', '<', '=', '!']);

const isWs = (c) => c === ' ' || c === '\t' || c === '\r' || c === '\n';
const isKeyDelim = (c) => c === '.' || c === '[' || c === ']' || isWs(c);

// parsePath(str) -> { ok, segments, error? }
// Tokenizes and parses a JSON-path string into a list of segments.
export function parsePath(str) {
  if (typeof str !== 'string') {
    return { ok: false, segments: [], error: 'path must be a string' };
  }
  if (str.length === 0) {
    return { ok: false, segments: [], error: 'empty path' };
  }

  const n = str.length;
  const segments = [];
  let i = 0;
  let prevWasBracket = false;

  // Read a bare key from the current position; stops at a delimiter.
  const readBareKey = () => {
    let j = i;
    while (j < n && !isKeyDelim(str[j])) j++;
    const key = str.slice(i, j);
    i = j;
    return key;
  };

  // Read a quoted string whose opening quote is str[i]; supports backslash
  // escapes (same set JSON strings allow, plus the quote itself).
  const readEscaped = (quote) => {
    i++; // opening quote
    if (i >= n && quote !== '') throw new Error('unterminated string');
    let out = '';
    while (i < n) {
      const c = str[i];
      if (c === quote) {
        i++;
        return out;
      }
      if (c === '\\') {
        i++;
        if (i >= n) throw new Error('unterminated escape sequence');
        const e = str[i];
        if (e === quote || e === '\\' || e === '/') out += e;
        else if (e === 'b') out += '\b';
        else if (e === 'f') out += '\f';
        else if (e === 'n') out += '\n';
        else if (e === 'r') out += '\r';
        else if (e === 't') out += '\t';
        else if (e === 'u') {
          const hex = str.slice(i + 1, i + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new Error('invalid \\u escape');
          out += String.fromCharCode(parseInt(hex, 16));
          i += 4;
        } else {
          throw new Error(`invalid escape '\\${e}'`);
        }
        i++;
      } else {
        out += c;
        i++;
      }
    }
    throw new Error(`unterminated string (expected closing ${quote})`);
  };

  // Parse the content after '?' (str[i] === '?'); consumes through ']'.
  const parseFilter = () => {
    i++;
    let j = i;
    while (j < n && !OP_CHARS.has(str[j]) && !isWs(str[j])) j++;
    const key = str.slice(i, j);
    i = j;
    if (key === '') throw new Error('expected key name in filter expression');
    while (i < n && isWs(str[i])) i++;
    let op;
    const c = str[i];
    if (c === '=') {
      if (str[i + 1] !== '=') throw new Error("expected '==' in filter expression");
      op = '==';
      i += 2;
    } else if (c === '!') {
      if (str[i + 1] !== '=') throw new Error("expected '!=' in filter expression");
      op = '!=';
      i += 2;
    } else if (c === '>') {
      op = str[i + 1] === '=' ? '>=' : '>';
      i += op.length;
    } else if (c === '<') {
      op = str[i + 1] === '=' ? '<=' : '<';
      i += op.length;
    } else {
      throw new Error('expected comparison operator in filter expression');
    }
    while (i < n && isWs(str[i])) i++;
    let ref;
    let refType;
    if (str[i] === "'") {
      ref = readEscaped("'");
      refType = 'string';
    } else {
      const m = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(str.slice(i));
      if (!m || m[0].length === 0) {
        throw new Error('expected number or single-quoted string in filter expression');
      }
      ref = Number(m[0]);
      refType = 'number';
      i += m[0].length;
    }
    while (i < n && isWs(str[i])) i++;
    if (i >= n || str[i] !== ']') throw new Error("expected ']' to close filter expression");
    i++;
    segments.push({ type: 'filter', key, op, ref, refType });
  };

  const expectBracketClose = () => {
    while (i < n && isWs(str[i])) i++;
    if (i >= n || str[i] !== ']') throw new Error("expected ']' to close bracket expression");
    i++;
    prevWasBracket = true;
  };

  // Parse one [...] group; str[i] === '['.
  const parseBracket = () => {
    i++;
    while (i < n && isWs(str[i])) i++;
    if (i >= n) throw new Error("expected ']' to close bracket expression");
    const c = str[i];
    if (c === '*') {
      i++;
      segments.push({ type: 'wildcard' });
      expectBracketClose();
    } else if (c === '?') {
      parseFilter();
    } else if (c === '"') {
      const key = readEscaped('"');
      segments.push({ type: 'key', key });
      expectBracketClose();
    } else if (c === '-' || (c >= '0' && c <= '9')) {
      const m = /^-?\d+/.exec(str.slice(i));
      if (!m || m[0].length === 0) throw new Error('expected array index');
      const index = Number(m[0]);
      i += m[0].length;
      if (!Number.isSafeInteger(index)) throw new Error(`invalid array index '${m[0]}'`);
      segments.push({ type: 'index', index });
      expectBracketClose();
    } else {
      throw new Error("expected array index, '*', '?' filter, or quoted key in brackets");
    }
  };

  try {
    while (i < n) {
      const c = str[i];
      if (c === '[') {
        parseBracket();
        continue;
      }
      if (c === '.') {
        let dots = 0;
        while (i < n && str[i] === '.') {
          dots++;
          i++;
        }
        if (dots > 2) throw new Error('too many dots in path');
        const key = readBareKey();
        if (key === '') {
          throw new Error(dots === 1 ? "expected key name after '.'" : "expected key name after '..'");
        }
        segments.push(dots === 1 ? { type: 'key', key } : { type: 'recursive', key });
        prevWasBracket = false;
        continue;
      }
      const key = readBareKey();
      if (key === '') throw new Error(`unexpected character '${c}'`);
      if (prevWasBracket) throw new Error(`expected '.' before key '${key}'`);
      segments.push({ type: 'key', key });
      prevWasBracket = false;
    }
  } catch (err) {
    return { ok: false, segments: [], error: err.message };
  }

  return { ok: true, segments, error: undefined };
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// matchesFilter(el, seg) decides whether array element `el` satisfies a filter.
// A match requires el to be an object whose `seg.key` value obeys `seg.op`.
function matchesFilter(el, seg) {
  if (!isObj(el) || !Object.prototype.hasOwnProperty.call(el, seg.key)) return false;
  const v = el[seg.key];
  if (seg.refType === 'number') {
    if (typeof v !== 'number') return false;
    switch (seg.op) {
      case '>':
        return v > seg.ref;
      case '>=':
        return v >= seg.ref;
      case '<':
        return v < seg.ref;
      case '<=':
        return v <= seg.ref;
      case '==':
        return v === seg.ref;
      case '!=':
        return v !== seg.ref;
      default:
        return false;
    }
  }
  // String reference: only equality (== / !=) is meaningful.
  if (typeof v !== 'string') return false;
  if (seg.op === '==') return v === seg.ref;
  if (seg.op === '!=') return v !== seg.ref;
  return false;
}

// evaluate(segments, doc) -> { ok, value, error? }
export function evaluate(segments, doc) {
  if (!Array.isArray(segments)) {
    return { ok: false, value: undefined, error: 'segments must be an array of path segments' };
  }

  let nodes = [doc];
  let multi = false;

  for (const seg of segments) {
    const next = [];
    if (seg.type === 'key') {
      for (const node of nodes) {
        if (isObj(node) && Object.prototype.hasOwnProperty.call(node, seg.key)) {
          next.push(node[seg.key]);
        }
      }
    } else if (seg.type === 'index') {
      for (const node of nodes) {
        if (Array.isArray(node)) {
          let idx = seg.index;
          if (idx < 0) idx = node.length + idx;
          if (idx >= 0 && idx < node.length) next.push(node[idx]);
        }
      }
    } else if (seg.type === 'wildcard') {
      multi = true;
      for (const node of nodes) {
        if (Array.isArray(node)) next.push(...node);
      }
    } else if (seg.type === 'recursive') {
      multi = true;
      const walk = (val) => {
        if (Array.isArray(val)) {
          for (const el of val) walk(el);
          return;
        }
        if (!isObj(val)) return;
        for (const k of Object.keys(val)) {
          if (k === seg.key) next.push(val[k]);
          walk(val[k]);
        }
      };
      for (const node of nodes) walk(node);
    } else if (seg.type === 'filter') {
      multi = true;
      for (const node of nodes) {
        if (!Array.isArray(node)) continue;
        for (const el of node) {
          if (matchesFilter(el, seg)) next.push(el);
        }
      }
    } else {
      return { ok: false, value: undefined, error: `unknown segment type '${seg.type}'` };
    }
    nodes = next;
  }

  let value;
  if (multi) {
    value = nodes.length > 0 ? nodes : undefined;
  } else if (nodes.length === 1) {
    value = nodes[0];
  } else {
    value = nodes.length === 0 ? undefined : nodes;
  }
  return { ok: true, value, error: undefined };
}

// selectPath(path, doc) -> { ok, value, error? }
// Parse + evaluate in one call.
export function selectPath(path, doc) {
  const parsed = parsePath(path);
  if (!parsed.ok) return { ok: false, value: undefined, error: parsed.error };
  return evaluate(parsed.segments, doc);
}