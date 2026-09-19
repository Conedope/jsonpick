// lib/format.js -- JSON output formatters for jsonpick.

// pretty(value, indent) serializes `value` as JSON with `indent`-space
// indentation. An undefined value serializes to the string "undefined"
// (JSON has no representation for it).
export function pretty(value, indent = 2) {
  if (value === undefined) return 'undefined';
  return JSON.stringify(value, null, indent);
}

// compact(value) serializes `value` as single-line JSON.
export function compact(value) {
  if (value === undefined) return 'undefined';
  return JSON.stringify(value);
}

// sortKeysRecursively(value) returns a deep copy in which every object's
// keys are sorted lexicographically. Arrays keep their element order.
export function sortKeysRecursively(value) {
  if (Array.isArray(value)) {
    return value.map(sortKeysRecursively);
  }
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortKeysRecursively(value[key]);
    }
    return out;
  }
  return value;
}