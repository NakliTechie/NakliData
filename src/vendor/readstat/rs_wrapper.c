// Thin wrapper around ReadStat for the browser: parse an in-memory
// statistical-format buffer and emit NDJSON (one JSON object per row,
// keyed by variable name) plus a column-name list. The JS side hands the
// NDJSON to DuckDB's read_json_auto — same shape as the sql.js SQLite
// reader. Compiled to wasm via emcc (see build.sh).
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "readstat.h"

typedef struct {
  char *buf;
  size_t len;
  size_t cap;
  int oom;  // M28: set once a realloc fails; further appends become no-ops
} strbuf;

static void sb_ensure(strbuf *sb, size_t extra) {
  if (sb->oom) return;
  if (sb->len + extra + 1 > sb->cap) {
    size_t ncap = sb->cap ? sb->cap : 4096;
    while (ncap < sb->len + extra + 1) ncap *= 2;
    // M28: realloc into a temp so a NULL return (wasm OOM) doesn't leak the old
    // buffer or leave sb->buf dangling — flag OOM and stop appending instead of
    // memcpy'ing into NULL.
    char *nbuf = realloc(sb->buf, ncap);
    if (!nbuf) {
      sb->oom = 1;
      return;
    }
    sb->buf = nbuf;
    sb->cap = ncap;
  }
}
static void sb_puts(strbuf *sb, const char *s) {
  size_t n = strlen(s);
  sb_ensure(sb, n);
  if (sb->oom) return;
  memcpy(sb->buf + sb->len, s, n);
  sb->len += n;
  sb->buf[sb->len] = 0;
}
static void sb_putc(strbuf *sb, char c) {
  sb_ensure(sb, 1);
  if (sb->oom) return;
  sb->buf[sb->len++] = c;
  sb->buf[sb->len] = 0;
}
// Append a JSON string literal (with surrounding quotes + escaping).
static void sb_json_str(strbuf *sb, const char *s) {
  sb_putc(sb, '"');
  for (; s && *s; s++) {
    unsigned char c = (unsigned char)*s;
    switch (c) {
      case '"': sb_puts(sb, "\\\""); break;
      case '\\': sb_puts(sb, "\\\\"); break;
      case '\n': sb_puts(sb, "\\n"); break;
      case '\r': sb_puts(sb, "\\r"); break;
      case '\t': sb_puts(sb, "\\t"); break;
      default:
        if (c < 0x20) {
          char tmp[8];
          snprintf(tmp, sizeof tmp, "\\u%04x", c);
          sb_puts(sb, tmp);
        } else {
          sb_putc(sb, (char)c);
        }
    }
  }
  sb_putc(sb, '"');
}

typedef struct {
  strbuf out;   // NDJSON rows
  strbuf cols;  // JSON array of column names
  char **names;
  int var_count;
  int cur_obs;
  int started_row;
  int row_count;
  int oom;  // M28: a calloc/strdup failed — rs_read reports it as a distinct code
} rs_ctx;

static rs_ctx g;

static int meta_handler(readstat_metadata_t *md, void *ctx) {
  (void)ctx;
  g.row_count = readstat_get_row_count(md);
  int vc = readstat_get_var_count(md);
  g.var_count = vc;
  // M28: a NULL calloc previously left g.names NULL, so the next var_handler's
  // `g.names[index] = …` was a NULL-deref. Flag OOM and abort the parse instead.
  g.names = calloc(vc > 0 ? vc : 1, sizeof(char *));
  if (!g.names) {
    g.var_count = 0;
    g.oom = 1;
    return READSTAT_HANDLER_ABORT;
  }
  return READSTAT_HANDLER_OK;
}

static int var_handler(int index, readstat_variable_t *var, const char *labels, void *ctx) {
  (void)labels;
  (void)ctx;
  const char *name = readstat_variable_get_name(var);
  if (index >= 0 && index < g.var_count) {
    // M28: check strdup — on OOM, abort rather than storing NULL silently.
    char *dup = strdup(name ? name : "");
    if (!dup) {
      g.oom = 1;
      return READSTAT_HANDLER_ABORT;
    }
    g.names[index] = dup;
  }
  return READSTAT_HANDLER_OK;
}

static void flush_row(void) {
  if (g.started_row) {
    sb_puts(&g.out, "}\n");
    g.started_row = 0;
  }
}

static int value_handler(int obs_index, readstat_variable_t *var, readstat_value_t value,
                         void *ctx) {
  (void)ctx;
  if (obs_index != g.cur_obs) {
    flush_row();
    g.cur_obs = obs_index;
  }
  if (!g.started_row) {
    sb_putc(&g.out, '{');
    g.started_row = 1;
  } else {
    sb_putc(&g.out, ',');
  }
  int vindex = readstat_variable_get_index(var);
  const char *name =
      (vindex >= 0 && vindex < g.var_count && g.names[vindex]) ? g.names[vindex]
                                                               : readstat_variable_get_name(var);
  sb_json_str(&g.out, name ? name : "");
  sb_putc(&g.out, ':');

  if (readstat_value_is_missing(value, var)) {
    sb_puts(&g.out, "null");
    return READSTAT_HANDLER_OK;
  }
  char tmp[64];
  switch (readstat_value_type(value)) {
    case READSTAT_TYPE_STRING:
    case READSTAT_TYPE_STRING_REF:
      sb_json_str(&g.out, readstat_string_value(value));
      break;
    case READSTAT_TYPE_INT8:
      snprintf(tmp, sizeof tmp, "%d", readstat_int8_value(value));
      sb_puts(&g.out, tmp);
      break;
    case READSTAT_TYPE_INT16:
      snprintf(tmp, sizeof tmp, "%d", readstat_int16_value(value));
      sb_puts(&g.out, tmp);
      break;
    case READSTAT_TYPE_INT32:
      snprintf(tmp, sizeof tmp, "%d", readstat_int32_value(value));
      sb_puts(&g.out, tmp);
      break;
    case READSTAT_TYPE_FLOAT: {
      float f = readstat_float_value(value);
      if (isnan(f) || isinf(f)) {
        sb_puts(&g.out, "null");
      } else {
        // %.7g = float32's ~7 significant decimal digits, so 3.58f prints
        // as "3.58" not "3.57999992" (float representation artifact).
        snprintf(tmp, sizeof tmp, "%.7g", (double)f);
        sb_puts(&g.out, tmp);
      }
      break;
    }
    case READSTAT_TYPE_DOUBLE: {
      double d = readstat_double_value(value);
      if (isnan(d) || isinf(d)) {
        sb_puts(&g.out, "null");
      } else {
        snprintf(tmp, sizeof tmp, "%.17g", d);
        sb_puts(&g.out, tmp);
      }
      break;
    }
    default:
      sb_puts(&g.out, "null");
  }
  return READSTAT_HANDLER_OK;
}

// L25: release the wasm-resident output of the previous parse (NDJSON + column
// list + name table). Exported so the JS side can free the last file's buffer
// after copying it out — otherwise it stays resident for the whole session.
void rs_free(void) {
  if (g.out.buf) free(g.out.buf);
  if (g.cols.buf) free(g.cols.buf);
  if (g.names) {
    for (int i = 0; i < g.var_count; i++) free(g.names[i]);
    free(g.names);
  }
  memset(&g, 0, sizeof g);
  g.cur_obs = -1;
}

// format: 0=dta 1=sav 2=por 3=sas7bdat 4=xport. Returns 0 on success, -1 on a
// file-write failure, -2 on an out-of-memory while building output, else the
// readstat_error_t code.
int rs_read(const uint8_t *data, int len, int format) {
  rs_free();  // free any prior run

  FILE *f = fopen("/rs_input", "wb");
  if (!f) return -1;
  fwrite(data, 1, len, f);
  fclose(f);

  readstat_parser_t *parser = readstat_parser_init();
  readstat_set_metadata_handler(parser, meta_handler);
  readstat_set_variable_handler(parser, var_handler);
  readstat_set_value_handler(parser, value_handler);

  readstat_error_t err;
  switch (format) {
    case 0: err = readstat_parse_dta(parser, "/rs_input", NULL); break;
    case 1: err = readstat_parse_sav(parser, "/rs_input", NULL); break;
    case 2: err = readstat_parse_por(parser, "/rs_input", NULL); break;
    case 3: err = readstat_parse_sas7bdat(parser, "/rs_input", NULL); break;
    case 4: err = readstat_parse_xport(parser, "/rs_input", NULL); break;
    default: err = READSTAT_ERROR_PARSE;
  }
  flush_row();
  readstat_parser_free(parser);
  remove("/rs_input");

  sb_putc(&g.cols, '[');
  for (int i = 0; i < g.var_count; i++) {
    if (i) sb_putc(&g.cols, ',');
    sb_json_str(&g.cols, g.names[i] ? g.names[i] : "");
  }
  sb_putc(&g.cols, ']');

  // M28: an allocation failed while building the name table or the output
  // buffers — report it distinctly instead of returning a truncated success.
  if (g.oom || g.out.oom || g.cols.oom) return -2;

  return err == READSTAT_OK ? 0 : (int)err;
}

const char *rs_ndjson(void) { return g.out.buf ? g.out.buf : ""; }
int rs_ndjson_len(void) { return (int)g.out.len; }
const char *rs_columns(void) { return g.cols.buf ? g.cols.buf : "[]"; }
int rs_rowcount(void) { return g.row_count; }
int rs_varcount(void) { return g.var_count; }
const char *rs_errmsg(int code) { return readstat_error_message((readstat_error_t)code); }
