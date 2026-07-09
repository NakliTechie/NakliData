#!/bin/bash
# Build ReadStat + wrapper to a single-file ES module wasm bundle.
set -euo pipefail
export PATH="/opt/homebrew/opt/python@3.14/bin:$PATH"

HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/ReadStat/src"
OUT="$HERE/out"
mkdir -p "$OUT"

# ReadStat core (read-side only — exclude *_write.c and readstat_writer.c).
CORE="$SRC/CKHashTable.c $SRC/readstat_bits.c $SRC/readstat_convert.c \
  $SRC/readstat_error.c $SRC/readstat_io_unistd.c $SRC/readstat_malloc.c \
  $SRC/readstat_metadata.c $SRC/readstat_parser.c $SRC/readstat_value.c \
  $SRC/readstat_variable.c"

# Per-format read sources (no writers).
FMT="$(find "$SRC/sas" "$SRC/spss" "$SRC/stata" -name '*.c' ! -name '*_write.c' | tr '\n' ' ')"

emcc \
  -O3 \
  -I"$SRC" \
  $CORE $FMT "$HERE/rs_wrapper.c" \
  -sUSE_ZLIB=1 \
  -sMODULARIZE=1 \
  -sEXPORT_ES6=1 \
  -sEXPORT_NAME=createReadStat \
  -sALLOW_MEMORY_GROWTH=1 \
  -sFILESYSTEM=1 \
  -sEXPORTED_RUNTIME_METHODS=ccall,cwrap,UTF8ToString,stringToNewUTF8,getValue,HEAPU8 \
  -sEXPORTED_FUNCTIONS=_rs_read,_rs_free,_rs_ndjson,_rs_ndjson_len,_rs_columns,_rs_rowcount,_rs_varcount,_rs_errmsg,_malloc,_free \
  -sENVIRONMENT=web,worker \
  -sSINGLE_FILE=0 \
  -o "$OUT/readstat.mjs"

echo "=== built ==="
ls -la "$OUT"
