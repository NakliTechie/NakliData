// Agent surfaces — the read-only SQL validator (Chunk 3 of the agent-surfaces
// track; DECISIONS EE-0a). "The model is never the safety boundary" — this is.
// An agent-issued query passes THIS before it can touch the engine: parse →
// reject any DDL / DML / PRAGMA / ATTACH / COPY / INSTALL / file-access system
// functions → require a single read-only statement → require every table
// position to be a mounted table (or a subquery), never a string literal or a
// table function. A violating query is rejected loudly, never executed.
//
// Engine-boundary clean (pure string work, no DOM/window/engine) — it's in the
// watched set so it can extract into a server-side sibling unchanged. The
// allowed-table set is INJECTED by the caller (the browser-side host builds it
// from the live schema); this module never reaches for it.
//
// It is a lexer-level guard, not a full SQL parser. Two design choices make that
// safe rather than sloppy:
//   1. TABLE POSITION IS ALLOW-SHAPED, not deny-shaped. After FROM / JOIN / a
//      comma in a FROM-list, the only things permitted are a mounted-table
//      identifier or a `( subquery )`. A string literal there (DuckDB's file /
//      URL replacement scan) or a `func(...)` there (read_parquet, sqlite_scan,
//      parquet_metadata, st_read, …) is rejected outright — we do NOT try to
//      enumerate every dangerous table function, because a blocklist of names
//      can never be complete (adversarial review, 2026-07-24).
//   2. Everywhere else, string/comment/backtick/quote-aware tokenizing means a
//      keyword hidden in `'a string'` or `-- a comment` never trips a guard.
// When in doubt it REJECTS; false positives are a loud, safe failure the user
// can see and rephrase.

export interface ValidationOk {
  ok: true;
  /** The validated SQL, unchanged (a convenience for `const { sql } = …`). */
  sql: string;
  /** Table identifiers the query reads (lowercased, unquoted) — for logging. */
  tables: string[];
}
export interface ValidationErr {
  ok: false;
  /** Human-readable rejection reason, safe to surface verbatim in the UI. */
  reason: string;
}
export type ValidationResult = ValidationOk | ValidationErr;

export interface ValidateOptions {
  /**
   * The set of table/view identifiers the agent may read (lowercased, unquoted).
   * When provided, any FROM/JOIN target that is neither in this set nor a CTE
   * defined in the same query is rejected. Omit to skip table-scoping (the
   * keyword + statement-shape + table-position guards still apply).
   */
  allowedTables?: ReadonlySet<string>;
}

/** Write / DML / DDL / session / extension keywords that could hide inside a
 *  read query — a DML CTE (`WITH x AS (DELETE … RETURNING *)`) or a subquery —
 *  and so are rejected as whole unquoted tokens ANYWHERE. Deliberately does NOT
 *  include the leading-only statement words (BEGIN / START / COMMIT / ROLLBACK /
 *  CHECKPOINT / VACUUM / ANALYZE / USE / RESET): those can only appear as the
 *  first token of a statement, where the read-query-starter gate already rejects
 *  them — listing them here only mis-rejects columns named `start` / `begin`.
 *  Likewise `replace` is omitted: it's a core string function, and the dangerous
 *  `INSERT OR REPLACE` / `CREATE OR REPLACE` forms are caught by insert/create. */
const FORBIDDEN_KEYWORDS = new Set([
  'insert',
  'update',
  'delete',
  'merge',
  'upsert',
  'create',
  'drop',
  'alter',
  'truncate',
  'attach',
  'detach',
  'copy',
  'install',
  'load',
  'pragma',
  'set',
  'call',
  'export',
  'import',
  'grant',
  'revoke',
  'prepare',
  'execute',
  'deallocate',
]);

/** File- / network- / connector-access functions. The table-position guard
 *  already rejects ANY `func(...)` after FROM/JOIN, so this set is the second
 *  layer: it catches these functions in a NON-table position (a SELECT-list or
 *  WHERE expression — `SELECT read_blob('/etc/passwd')`). Matched on the token's
 *  unquoted word (so `"read_csv"(…)` is caught too) immediately before `(`. */
const FORBIDDEN_FUNCTIONS = new Set([
  'read_csv',
  'read_csv_auto',
  'read_parquet',
  'parquet_scan',
  'parquet_metadata',
  'parquet_schema',
  'parquet_file_metadata',
  'parquet_kv_metadata',
  'read_json',
  'read_json_auto',
  'read_json_objects',
  'read_ndjson',
  'read_ndjson_auto',
  'read_ndjson_objects',
  'read_text',
  'read_blob',
  'read_arrow',
  'arrow_scan',
  'scan_arrow_ipc',
  'read_xlsx',
  'st_read',
  'st_readshp',
  'st_drivers',
  'sqlite_scan',
  'sqlite_attach',
  'postgres_scan',
  'postgres_scan_pushdown',
  'postgres_attach',
  'postgres_query',
  'mysql_scan',
  'mysql_query',
  'iceberg_scan',
  'iceberg_metadata',
  'iceberg_snapshots',
  'delta_scan',
  'glob',
  'sniff_csv',
  'nextval',
  'currval',
  'getvariable',
  'setseed',
]);

/** Read-query starters. DuckDB accepts SELECT/WITH, FROM-first (`FROM t SELECT`
 *  or bare `FROM t`), VALUES, TABLE (`TABLE t` ≡ `SELECT * FROM t`), DESCRIBE,
 *  and a parenthesised select — all read-only. */
const QUERY_STARTERS = new Set(['select', 'with', 'from', 'values', 'table', 'describe']);

/** Words that END a FROM-item list (a clause boundary or a join keyword) — used
 *  to know a following bareword is NOT an implicit table alias. */
const FROM_LIST_BOUNDARIES = new Set([
  'where',
  'group',
  'having',
  'order',
  'limit',
  'offset',
  'window',
  'qualify',
  'union',
  'except',
  'intersect',
  'on',
  'using',
  'join',
  'natural',
  'cross',
  'inner',
  'left',
  'right',
  'full',
  'anti',
  'semi',
  'asof',
  'positional',
  'sample',
  'tablesample',
  'fetch',
  'for',
  'returning',
  'as',
  'select',
  'with',
]);

interface Token {
  /** The raw token text (identifiers keep their quotes). */
  text: string;
  /** Lowercased bare word for keyword matching; null for strings/punctuation. */
  word: string | null;
  /** True for a single-quoted string literal or a $$-quoted string. */
  isString: boolean;
  /** True when the word came from a quoted identifier ("x" or `x`) — a NAME,
   *  never a keyword. */
  isQuotedIdent: boolean;
}

/**
 * Tokenize SQL with awareness of `'strings'`, `"quoted idents"`, `` `backtick` ``
 * idents, `$$dollar$$` strings, `-- line` comments, and block comments. Keywords
 * inside strings/comments never surface as `word`, so they can't trip the
 * guards. Semicolons and parens surface as their own single-char tokens.
 */
function tokenize(sql: string): { tokens: Token[]; error: string | null } {
  const tokens: Token[] = [];
  let i = 0;
  const n = sql.length;
  const pushIdent = (text: string, word: string, quoted: boolean) =>
    tokens.push({ text, word, isString: false, isQuotedIdent: quoted });
  while (i < n) {
    const c = sql[i] as string;
    // Whitespace
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v') {
      i++;
      continue;
    }
    // Line comment
    if (c === '-' && sql[i + 1] === '-') {
      i += 2;
      while (i < n && sql[i] !== '\n') i++;
      continue;
    }
    // Block comment (non-nesting, matches DuckDB)
    if (c === '/' && sql[i + 1] === '*') {
      i += 2;
      while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      if (i >= n) return { tokens, error: 'unterminated block comment' };
      i += 2;
      continue;
    }
    // Single-quoted string ('' escapes a quote). Also handles the DuckDB E'…'
    // escape-string prefix (the leading E was tokenized as a word already; the
    // quote here is what matters).
    if (c === "'") {
      i++;
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (sql[i] === "'") break;
        i++;
      }
      if (i >= n) return { tokens, error: 'unterminated string literal' };
      i++; // closing quote
      tokens.push({ text: "'…'", word: null, isString: true, isQuotedIdent: false });
      continue;
    }
    // Dollar-quoted string ($$ … $$ or $tag$ … $tag$)
    if (c === '$') {
      const tagMatch = /^\$([A-Za-z_]\w*)?\$/.exec(sql.slice(i));
      if (tagMatch) {
        const tag = tagMatch[0];
        const end = sql.indexOf(tag, i + tag.length);
        if (end === -1) return { tokens, error: 'unterminated dollar-quoted string' };
        i = end + tag.length;
        tokens.push({ text: '$$…$$', word: null, isString: true, isQuotedIdent: false });
        continue;
      }
    }
    // Double-quoted OR backtick-quoted identifier (doubled quote escapes).
    if (c === '"' || c === '`') {
      const q = c;
      let ident = '';
      i++;
      while (i < n) {
        if (sql[i] === q && sql[i + 1] === q) {
          ident += q;
          i += 2;
          continue;
        }
        if (sql[i] === q) break;
        ident += sql[i];
        i++;
      }
      if (i >= n) return { tokens, error: 'unterminated quoted identifier' };
      i++; // closing quote
      // A quoted identifier is a NAME. Its lowercased word is carried for
      // table-scoping AND for the forbidden-FUNCTION check (so `"read_csv"(…)`
      // is caught), but never for the forbidden-KEYWORD check.
      pushIdent(`${q}${ident}${q}`, ident.toLowerCase(), true);
      continue;
    }
    // Word (identifier / keyword / number)
    if (/[A-Za-z_0-9]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z_0-9.]/.test(sql[j] as string)) j++;
      const text = sql.slice(i, j);
      pushIdent(text, text.toLowerCase(), false);
      i = j;
      continue;
    }
    // Punctuation — surface `;` `(` `)` `,` individually; collapse other
    // operator chars into single-char tokens (enough for the guards).
    tokens.push({ text: c, word: null, isString: false, isQuotedIdent: false });
    i++;
  }
  return { tokens, error: null };
}

/** A token that can carry a forbidden KEYWORD — an unquoted word (not a string,
 *  not a quoted identifier, not punctuation). */
function isKeywordCandidate(t: Token): boolean {
  return !t.isString && !t.isQuotedIdent && t.word !== null;
}

/** True when the token is an identifier (bare or quoted) usable as a name. */
function isNameToken(t: Token): boolean {
  return !t.isString && t.word !== null;
}

/** Strip a schema/catalog qualifier (`main.t`, `db.main.t`) to the final part. */
function lastSegment(word: string): string {
  const parts = word.split('.');
  return parts[parts.length - 1] ?? word;
}

/**
 * Validate that `sql` is a single, read-only query safe to run on the mounted
 * schema. Returns `{ ok: true, sql, tables }` or `{ ok: false, reason }`.
 */
export function validateReadOnlySql(sql: string, opts: ValidateOptions = {}): ValidationResult {
  if (typeof sql !== 'string' || sql.trim() === '') {
    return { ok: false, reason: 'Empty query.' };
  }
  const { tokens, error } = tokenize(sql);
  if (error) return { ok: false, reason: `Could not parse the query (${error}).` };

  // Reject multiple statements: anything after the first `;` (bar trailing
  // whitespace, already dropped) means a second statement.
  const firstSemi = tokens.findIndex((t) => t.text === ';');
  if (firstSemi !== -1 && tokens.slice(firstSemi + 1).some((t) => t.text !== ';')) {
    return {
      ok: false,
      reason: 'Only a single statement is allowed (no `;`-separated statements).',
    };
  }
  const body = tokens.filter((t) => t.text !== ';');
  if (body.length === 0) return { ok: false, reason: 'Empty query.' };

  // First significant token must open a read query. A leading `(` is fine
  // (parenthesised SELECT); skip past leading `(`.
  let k = 0;
  while (k < body.length && body[k]?.text === '(') k++;
  const first = body[k];
  if (
    !first ||
    !isKeywordCandidate(first) ||
    first.word === null ||
    !QUERY_STARTERS.has(first.word)
  ) {
    return {
      ok: false,
      reason: `Only read-only queries are allowed — the statement must begin with SELECT, WITH, FROM, VALUES, TABLE, or DESCRIBE (got "${first?.text ?? '?'}").`,
    };
  }

  // Reject forbidden keywords anywhere (unquoted whole words only).
  for (const t of body) {
    if (isKeywordCandidate(t) && t.word !== null && FORBIDDEN_KEYWORDS.has(t.word)) {
      return {
        ok: false,
        reason: `Rejected: "${t.word.toUpperCase()}" is not allowed — the agent may only run read-only SELECT queries, not writes, DDL, PRAGMA, or session statements.`,
      };
    }
  }

  // Reject forbidden file/network/session FUNCTIONS anywhere (word — quoted or
  // not — immediately followed by `(`).
  for (let idx = 0; idx < body.length; idx++) {
    const t = body[idx];
    if (!t || t.word === null || t.isString) continue;
    if (FORBIDDEN_FUNCTIONS.has(t.word) && body[idx + 1]?.text === '(') {
      return {
        ok: false,
        reason: `Rejected: the function "${t.word}(…)" can read outside the mounted schema (a local file, a URL, or session state) and is not allowed.`,
      };
    }
  }

  // Table-position guard + scoping. This is the load-bearing check: every
  // FROM/JOIN target (and every comma-separated relation in a FROM list) must be
  // a mounted-table identifier or a `( subquery )` — never a string literal
  // (file/URL replacement scan) or a `func(...)` (table function).
  const cteNames = collectCteNames(body);
  const scan = scanFromClauses(body, opts.allowedTables ?? null, cteNames);
  if (!scan.ok) return { ok: false, reason: scan.reason };

  return { ok: true, sql, tables: scan.refs };
}

/** Names introduced by `WITH name AS (…)`, `WITH name (cols) AS (…)`, and
 *  comma-separated CTEs. Lowercased, unquoted. */
function collectCteNames(body: Token[]): Set<string> {
  const names = new Set<string>();
  for (let i = 0; i < body.length; i++) {
    const t = body[i];
    if (!t || !isKeywordCandidate(t) || t.word !== 'with') continue;
    let j = i + 1;
    if (body[j]?.word === 'recursive') j++;
    while (j < body.length) {
      const nameTok = body[j];
      if (!nameTok || nameTok.word === null) break;
      names.add(nameTok.word);
      j++;
      if (body[j]?.text === '(') j = skipParens(body, j);
      if (body[j]?.word !== 'as') break;
      j++;
      if (body[j]?.text === '(') j = skipParens(body, j);
      if (body[j]?.text === ',') {
        j++;
        continue;
      }
      break;
    }
  }
  return names;
}

/** Index just past the matching `)` for the `(` at `p`. If unbalanced, returns
 *  body.length. */
function skipParens(body: Token[], p: number): number {
  let depth = 0;
  for (let j = p; j < body.length; j++) {
    if (body[j]?.text === '(') depth++;
    else if (body[j]?.text === ')') {
      depth--;
      if (depth === 0) return j + 1;
    }
  }
  return body.length;
}

/** Skip an optional table alias after a base-table ref: `AS name`, a bare
 *  implicit-alias identifier (that isn't a clause/join keyword), and an optional
 *  `(col, …)` alias-column list. Returns the position after the alias. */
function skipAlias(body: Token[], p: number): number {
  let j = p;
  if (body[j]?.word === 'as') {
    j++;
    if (body[j] && isNameToken(body[j] as Token)) j++;
  } else {
    const t = body[j];
    // A bare identifier that is not a boundary/join keyword is an implicit alias.
    if (
      t &&
      isNameToken(t) &&
      (t.isQuotedIdent || (t.word !== null && !FROM_LIST_BOUNDARIES.has(t.word)))
    ) {
      j++;
    }
  }
  if (body[j]?.text === '(') j = skipParens(body, j);
  return j;
}

interface ScanOk {
  ok: true;
  refs: string[];
}
interface ScanErr {
  ok: false;
  reason: string;
}

/**
 * Walk every FROM / JOIN clause and validate the table position(s). FROM takes a
 * comma-separated list of relations; JOIN takes one. Each relation must be a
 * mounted-table identifier (scoped against `allowed`, CTE names exempt) or a
 * `( subquery )`. A string literal or a `func(...)` in table position is
 * rejected.
 */
function scanFromClauses(
  body: Token[],
  allowed: ReadonlySet<string> | null,
  cteNames: Set<string>,
): ScanOk | ScanErr {
  const refs: string[] = [];
  for (let i = 0; i < body.length; i++) {
    const t = body[i];
    if (!t || !isKeywordCandidate(t)) continue;
    if (t.word === 'from' || t.word === 'join') {
      const list = t.word === 'from';
      let j = i + 1;
      while (j < body.length) {
        const r = validateTableRef(body, j, allowed, cteNames, refs);
        if (!r.ok) return r;
        j = r.next;
        if (list && body[j]?.text === ',') {
          j++;
          continue;
        }
        break;
      }
    }
  }
  return { ok: true, refs };
}

/** Validate a single relation at position `p`. Returns the next position to
 *  continue from, or a rejection. */
function validateTableRef(
  body: Token[],
  p: number,
  allowed: ReadonlySet<string> | null,
  cteNames: Set<string>,
  refs: string[],
): { ok: true; next: number } | ScanErr {
  const tok = body[p];
  if (!tok) return { ok: false, reason: 'Expected a table name after FROM/JOIN.' };
  if (tok.isString) {
    return {
      ok: false,
      reason:
        'Rejected: a string literal in table position is not allowed — it would trigger a file or URL scan outside the mounted schema.',
    };
  }
  if (tok.text === '(') {
    // Subquery / derived table — allowed. (Its inner FROMs were already visited
    // by the outer loop.)
    return { ok: true, next: skipAlias(body, skipParens(body, p)) };
  }
  if (isNameToken(tok) && tok.word !== null) {
    if (body[p + 1]?.text === '(') {
      return {
        ok: false,
        reason: `Rejected: the table function "${tok.word}(…)" can read outside the mounted schema and is not allowed. Query a mounted table by name instead.`,
      };
    }
    const name = lastSegment(tok.word);
    if (!cteNames.has(name)) {
      if (allowed && !allowed.has(name)) {
        return {
          ok: false,
          reason: `Rejected: "${name}" is not a mounted table. The agent can only read tables in the current workspace.`,
        };
      }
      refs.push(name);
    }
    return { ok: true, next: skipAlias(body, p + 1) };
  }
  return { ok: false, reason: `Rejected: unexpected token "${tok.text}" in table position.` };
}
