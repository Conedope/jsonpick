# jsonpick

A jq-inspired JSON query CLI with **zero dependencies**. It can validate JSON,
pretty-print / compact it, and select values using a small JSON-path DSL — all
offline, using only Node built-ins.

- Node.js `>=18`, ES modules, no npm dependencies.
- Usage: `jsonpick [options] [input]` where input is a file path, `-` (stdin),
  or stdin when omitted. `--json '{"a":1}'` supplies the document directly.

## Install / run

```sh
npm link            # exposes the `jsonpick` bin, or:
node bin/jsonpick.js --help
npm test            # runs node --test test/*.test.js
```

## Commands

```sh
# pretty-print (default action; 2-space indent)
$ cat shop.json | jsonpick
{
  "store": {
    "book": [
      {
        "title": "A",
        "score": 5
      },

# compact single-line output
$ jsonpick -c shop.json
{"store":{"book":[{"title":"A","score":5}]}}

# select one path (single values print on their own line)
$ jsonpick -p 'store.book[1].title' shop.json
"B"

# select several paths, one per line
$ jsonpick --paths 'meta.tags[0]' 'store.name' shop.json
"json"
"my shop"

# validate only
$ jsonpick --validate shop.json && echo OK
OK

# inspect the type of a selected value
$ printf '{"v":[1,2]}' | jsonpick -t -p v
array
```

### Verified example session (jsonpick 1.0.0, Node v22)

Given `shop.json`:

```json
{"store":{"book":[{"title":"A","score":5},{"title":"B","score":9}],"name":"my shop"},"meta":{"tags":["json","cli"]}}
```

| Command | Output |
| --- | --- |
| `jsonpick shop.json` | pretty-printed document (2-space indent) |
| `jsonpick -p 'store.book[1]' shop.json` | `{"title":"B","score":9}` pretty-printed |
| `jsonpick -c -p 'store.book[0].score' shop.json` | `5` |
| `jsonpick -c -p '..title' shop.json` | `["A","B"]` (recursive descent) |
| `jsonpick -c -p 'store.book[?score>6]' shop.json` | `[{"score":9,"title":"B"}]` |
| `printf '{"a":1}' \| jsonpick -p zzz` | *(nothing printed, exit 0)* |

Selected values are printed as JSON: strings are quoted (`"B"`), objects and
arrays are formatted.

## Path DSL

A path is parsed by a small tokenizer (no `eval`, no regex-only parsing).
Each step is applied to the document in order.

| Syntax | Meaning | Result type |
| --- | --- | --- |
| `a.b.c` | object key access | value or missing |
| `a["my key"]` | quoted key (double quotes, JSON escapes supported) | value or missing |
| `a[0]` | array index (non-negative) | value or missing |
| `a[-1]` | index counted from the end (`-1` = last) | value or missing |
| `a[*]` | every element of an array | **array** (multi) |
| `..key` | recursive descent: every value stored under `key`, anywhere below | **array** (multi) |
| `a[?score>4]` | filter the array `a` by predicate on each element's `score` | **array** (multi) |
| `.a` or `[0]` / `["a"]` | path may start at the root with a dot or bracket | — |

Filter operators: `>` `<` `>=` `<=` `==` `!=` against numbers
(`?score>4`, `?score>=4.5`), or `==`/`!=` against single-quoted strings
(`?name=='bob'`, `?name!='bob'`). A filter keeps array elements that are
objects whose named key satisfies the predicate; non-object elements and
elements without the key are dropped. `>` `<` `>=` `<=` only ever match numbers
(string values never satisfy an ordering comparison).

### Semantics at the edges (defined + tested)

- A **missing key** or **out-of-range index** produces no match.
- `[*]` on a non-array, a **filter on a non-array**, and a **recursive descent
  that finds nothing** all produce no match.
- If the whole selection has no match, the result is **undefined**: the CLI
  prints nothing and exits `0` (also with `--paths`, where that line is skipped).
- A path containing `[*]`, `..`, or a filter is a **multi path**: its result is
  an array of all matches (or undefined when nothing matched). Plain paths
  return a single value.
- Deep recursion / nesting is guarded in the error scanner.

## Options

| Option | Description |
| --- | --- |
| `-p, --path P` | select one path and print the value |
| `-a, --paths P...` | select several paths; each value on its own line (consumes following non-option arguments; `--paths=a` form also works). With multiple selections, each value is printed compact; `-i` switches them to pretty |
| `--validate` | parse only: exit `0` valid, `1` invalid (prints nothing on success) |
| `-c, --compact` | single-line JSON output |
| `-s, --sort-keys` | sort object keys recursively before printing (arrays keep their order) |
| `-i, --indent N` | indentation width for pretty output (default `2`) |
| `-t, --typeof` | print the type of each selected value: `object`, `array`, `number`, `string`, `boolean`, `null`, `undefined` |
| `-v, --version` | print the version |
| `-h, --help` | print help |
| `--json '...'` | use the argument as the document (cannot be combined with a file argument) |

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | success (including valid `--validate` and selections that find nothing) |
| `1` | invalid JSON, or an invalid path expression |
| `2` | input file missing or unreadable |
| `3` | usage error (unknown option, bad argument) |

`--validate` prints nothing to stdout on success; JSON and path errors go to
stderr as `jsonpick: parse error at line L, column C: message` (line/column are
computed deterministically, even when V8's error message carries no position).

## Development

```sh
npm test
```

Runs `node --test test/*.test.js` — library tests for the path evaluator
(`test/path.test.js`), the formatters (`test/format.test.js`), and end-to-end
CLI tests (`test/cli.test.js`) all with concrete assertions.

## License

MIT © 2026 Conedope. See [LICENSE](LICENSE).