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

// Stata date decoding. Stata stores dates as numeric offsets from 1960-01-01
// with a display format (%td = whole days, %tc = milliseconds). Without decoding
// a date column mounts as a meaningless number (21915 for 2020-01-01); we convert
// %td/%tc to an ISO string so DuckDB's read_json_auto types it as DATE/TIMESTAMP.
// Only applied to Stata (.dta) — SPSS/SAS use different formats + epochs and are
// left as raw numeric (README "Known limitations").
enum { DATE_NONE = 0, DATE_DAILY = 1, DATE_DATETIME = 2 };

// Days from 1960-01-01 (Stata epoch) to 1970-01-01 (the civil algorithm's epoch).
#define STATA_EPOCH_DAYS 3653

typedef struct {
  strbuf out;   // NDJSON rows
  strbuf cols;  // JSON array of column names
  char **names;
  int *datekind;  // per-variable Stata date kind (DATE_NONE/DAILY/DATETIME)
  int var_count;
  int cur_obs;
  int started_row;
  int row_count;
  int fmt;  // file format code (0=dta) — date decoding is Stata-only
  int oom;  // M28: a calloc/strdup failed — rs_read reports it as a distinct code
} rs_ctx;

static rs_ctx g;

// Classify a Stata display format string → date kind. `%td…`/`%d…` = daily,
// `%tc…`/`%tC…` = datetime (ms). Other period formats (%tw/%tm/%tq/%th/%ty) are
// left as raw numeric — they're not a single calendar instant.
static int stata_date_kind(const char *fmt) {
  if (!fmt || fmt[0] != '%') return DATE_NONE;
  if (fmt[1] == 't') {
    if (fmt[2] == 'c' || fmt[2] == 'C') return DATE_DATETIME;
    if (fmt[2] == 'd') return DATE_DAILY;
    return DATE_NONE;
  }
  if (fmt[1] == 'd') return DATE_DAILY;  // legacy %d…
  return DATE_NONE;
}

// Howard Hinnant's civil-from-days: days since 1970-01-01 → (y, m, d). Exact for
// the full proleptic Gregorian range; no libc/timezone dependency.
static void civil_from_days(long z, int *yy, int *mm, int *dd) {
  z += 719468;
  long era = (z >= 0 ? z : z - 146096) / 146097;
  unsigned doe = (unsigned)(z - era * 146097);
  unsigned yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
  long y = (long)yoe + era * 400;
  unsigned doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  unsigned mp = (5 * doy + 2) / 153;
  unsigned d = doy - (153 * mp + 2) / 5 + 1;
  unsigned m = mp < 10 ? mp + 3 : mp - 9;
  *yy = (int)(y + (m <= 2));
  *mm = (int)m;
  *dd = (int)d;
}

// Emit a numeric Stata date value as a quoted ISO string. daily → the offset is
// in days; datetime → in milliseconds. Uses floored division so pre-1960 (negative
// offset) dates decode correctly.
static void sb_stata_date(strbuf *sb, int kind, double value) {
  long days;
  long tod = 0;  // seconds within the day (datetime only)
  if (kind == DATE_DATETIME) {
    long secs = (long)(value / 1000.0);  // ms → s (truncate sub-second)
    days = secs / 86400;
    tod = secs - days * 86400;
    if (tod < 0) {  // floor toward negative infinity
      tod += 86400;
      days -= 1;
    }
  } else {
    days = (long)value;
  }
  int y, m, d;
  civil_from_days(days - STATA_EPOCH_DAYS, &y, &m, &d);
  char tmp[40];
  if (kind == DATE_DATETIME) {
    int hh = (int)(tod / 3600), mi = (int)((tod % 3600) / 60), ss = (int)(tod % 60);
    snprintf(tmp, sizeof tmp, "\"%04d-%02d-%02d %02d:%02d:%02d\"", y, m, d, hh, mi, ss);
  } else {
    snprintf(tmp, sizeof tmp, "\"%04d-%02d-%02d\"", y, m, d);
  }
  sb_puts(sb, tmp);
}

static int meta_handler(readstat_metadata_t *md, void *ctx) {
  (void)ctx;
  g.row_count = readstat_get_row_count(md);
  int vc = readstat_get_var_count(md);
  g.var_count = vc;
  // M28: a NULL calloc previously left g.names NULL, so the next var_handler's
  // `g.names[index] = …` was a NULL-deref. Flag OOM and abort the parse instead.
  int n = vc > 0 ? vc : 1;
  g.names = calloc(n, sizeof(char *));
  g.datekind = calloc(n, sizeof(int));  // DATE_NONE (0) for every column by default
  if (!g.names || !g.datekind) {
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
    // Stata-only: remember which columns carry a %td/%tc date format so
    // value_handler can decode their numeric offset to an ISO string.
    if (g.fmt == 0) g.datekind[index] = stata_date_kind(readstat_variable_get_format(var));
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
  // Stata date column: decode the numeric offset (days for %td, ms for %tc) to
  // an ISO string. Falls through to normal emission for a non-numeric/NaN value.
  int dk = (vindex >= 0 && vindex < g.var_count) ? g.datekind[vindex] : DATE_NONE;
  if (dk != DATE_NONE) {
    int isnum = 1;
    double num;
    switch (readstat_value_type(value)) {
      case READSTAT_TYPE_INT8: num = readstat_int8_value(value); break;
      case READSTAT_TYPE_INT16: num = readstat_int16_value(value); break;
      case READSTAT_TYPE_INT32: num = readstat_int32_value(value); break;
      case READSTAT_TYPE_FLOAT: num = readstat_float_value(value); break;
      case READSTAT_TYPE_DOUBLE: num = readstat_double_value(value); break;
      default:
        isnum = 0;
        num = 0;
    }
    if (isnum && !isnan(num) && !isinf(num)) {
      sb_stata_date(&g.out, dk, num);
      return READSTAT_HANDLER_OK;
    }
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
  if (g.datekind) free(g.datekind);
  memset(&g, 0, sizeof g);
  g.cur_obs = -1;
}

// format: 0=dta 1=sav 2=por 3=sas7bdat 4=xport. Returns 0 on success, -1 on a
// file-write failure, -2 on an out-of-memory while building output, else the
// readstat_error_t code.
int rs_read(const uint8_t *data, int len, int format) {
  rs_free();  // free any prior run
  g.fmt = format;  // gates Stata-only date decoding (rs_free memset cleared it)

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
