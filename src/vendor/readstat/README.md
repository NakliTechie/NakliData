# Vendored ReadStat (wasm)

Reads SPSS / Stata / SAS statistical files in the browser, sovereign +
offline. Powers `src/lazy/readstat-reader.ts`, which the engine's
`registerReadStat` mount path calls.

## Why we vendor a prebuilt artifact

DuckDB's `read_stat` community extension is **not published for the wasm
platform** (404 on community-extensions.duckdb.org for every version/wasm
target — see DECISIONS CA), so it can never load in-browser. Instead we compile
**ReadStat** (the small C library that R's `haven` and the dead DuckDB ext both
wrap) to wasm ourselves. This is the same "own the reader" posture as the sql.js
SQLite bypass and the SheetJS xlsx path.

There is no npm/CDN source to fetch at postinstall, and CI/deploy (Cloudflare
Workers Build) has no Emscripten toolchain — so the built artifacts are
**committed**, not regenerated on install:

- `../../../public/readstat-wasm/readstat.wasm` — the wasm binary (served
  same-origin from `dist/readstat-wasm/`).
- `readstat-glue.js` — the Emscripten ES-module glue (bundled into the
  `readstat-reader` lazy chunk by esbuild). `readstat-glue.d.ts` types it.

## Provenance (rebuild to verify)

- **Upstream:** https://github.com/WizardMac/ReadStat
- **Pinned commit:** `3c68974fbb35c5bf0888fd603cd99b8253477359`
- **Emscripten:** emcc 6.0.1
- **Sources in this dir:** `rs_wrapper.c` (the C wrapper — parses a buffer,
  emits NDJSON + column list) and `build.sh` (the emcc invocation).

To rebuild:

```sh
git clone https://github.com/WizardMac/ReadStat.git
git -C ReadStat checkout 3c68974fbb35c5bf0888fd603cd99b8253477359
# place rs_wrapper.c + build.sh alongside, then:
bash build.sh            # → out/readstat.wasm + out/readstat.mjs
cp out/readstat.wasm ../../../public/readstat-wasm/readstat.wasm
cp out/readstat.mjs  readstat-glue.js
```

The build compiles ReadStat's read-side core + SAS/SPSS/Stata parsers (no
writers) with `-sUSE_ZLIB=1` (for `.zsav`), `-sEXPORT_ES6=1 -sMODULARIZE=1`,
and `-sENVIRONMENT=web,worker` (no Node paths → no CSP-tripping `eval`/`require`).

## C API (exported functions)

- `int rs_read(const uint8_t* data, int len, int format)` — parse a buffer;
  `format` = 0 dta · 1 sav · 2 por · 3 sas7bdat · 4 xport. Returns 0 on success
  or the ReadStat error code.
- `const char* rs_ndjson(void)` / `int rs_ndjson_len(void)` — the NDJSON output.
- `const char* rs_columns(void)` — JSON array of variable names.
- `int rs_rowcount(void)` — row count (may be -1 when the format's header omits
  it, e.g. SAS xport; the JS side then counts NDJSON lines).
- `const char* rs_errmsg(int code)` — human-readable error string.

## Known limitations

- **Encoding:** string columns are converted to UTF-8 via musl iconv. Files
  declaring an unusual codepage may need review.
- **Dates:** **Stata** `%td` (daily) + `%tc` (datetime) columns ARE decoded to
  ISO strings (`2020-01-01` / `2020-01-01 13:30:00`) so DuckDB types them as
  DATE/TIMESTAMP — see `stata_date_kind`/`sb_stata_date` in `rs_wrapper.c`
  (DECISIONS CW; verified against `tests/e2e/fixtures/sample-data/stat_dates.dta`).
  Still raw numeric: other Stata period formats (`%tw/%tm/%tq/%th/%ty` — not a
  single instant) and **all SPSS/SAS** date formats (different epochs; no
  pyreadstat fixture on hand to verify a decoder). Those remain the refinement.
