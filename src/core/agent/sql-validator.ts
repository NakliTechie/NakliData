// Agent surfaces — the read-only SQL validator (Chunk 3 of the agent-surfaces
// track; DECISIONS EE-0a). "The model is never the safety boundary" — this is
// (facet-m0-handoff.md). An agent-issued query passes THIS before it can touch
// the engine: parse → reject any DDL / DML / PRAGMA / ATTACH / COPY / INSTALL /
// file-access system functions → require a single read-only statement → scope
// every table reference to the mounted schema. A violating query is rejected
// loudly, never executed.
//
// Engine-boundary clean (pure string work, no DOM/window/engine) — it's in the
// watched set so it can extract into a server-side sibling unchanged. The
// allowed-table set is INJECTED by the caller (the browser-side host builds it
// from the live schema); this module never reaches for it.
//
// This is a lexer-level guard, not a full SQL parser. That is deliberate: a
// full grammar is a large dependency and a large attack surface of its own. The
// guard tokenizes with string/comment/identifier awareness (so `'DROP'` in a
// literal never trips it), then enforces a small, strict allow-shape —
// SELECT/WITH/FROM/VALUES/TABLE read queries only. When in doubt it REJECTS;
// false positives are a loud, safe failure the user can see and rephrase.

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
   * keyword + statement-shape guards still apply).
   */
  allowedTables?: ReadonlySet<string>;
}

/** Write / DDL / session / extension / transaction keywords — rejected as whole
 *  tokens ANYWHERE in the statement (a write buried in a CTE or subquery is
 *  still a write). Read-only queries never legitimately contain these
 *  unquoted. */
const FORBIDDEN_KEYWORDS = new Set([
  'insert',
  'update',
  'delete',
  'merge',
  'upsert',
  'replace',
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
  'reset',
  'call',
  'export',
  'import',
  'vacuum',
  'analyze',
  'checkpoint',
  'begin',
  'start',
  'commit',
  'rollback',
  'grant',
  'revoke',
  'use',
  'prepare',
  'execute',
  'deallocate',
]);

/** File- / network-access + session functions. Even inside a SELECT these reach
 *  outside the mounted schema (read a local file, fetch a URL, mutate a
 *  sequence), so they are rejected regardless of statement shape. Matched as a
 *  function call — the token immediately followed by `(`. */
const FORBIDDEN_FUNCTIONS = new Set([
  'read_csv',
  'read_csv_auto',
  'read_parquet',
  'parquet_scan',
  'read_json',
  'read_json_auto',
  'read_json_objects',
  'read_ndjson',
  'read_ndjson_auto',
  'read_ndjson_objects',
  'read_text',
  'read_blob',
  'read_arrow',
  'scan_arrow_ipc',
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

interface Token {
  /** The raw token text (identifiers keep their quotes). */
  text: string;
  /** Lowercased bare word for keyword matching; null for strings/punctuation. */
  word: string | null;
  /** True for a single-quoted string literal or a $$-quoted string. */
  isString: boolean;
}

/**
 * Tokenize SQL with awareness of `'strings'`, `"quoted idents"`, `$$dollar$$`
 * strings, `-- line` comments, and `/* block *​/` comments. Keywords inside
 * strings/comments never surface as `word`, so they can't trip the guards.
 * Semicolons and parens surface as their own single-char tokens.
 */
function tokenize(sql: string): { tokens: Token[]; error: string | null } {
  const tokens: Token[] = [];
  let i = 0;
  const n = sql.length;
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
    // Single-quoted string ('' escapes a quote)
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
      tokens.push({ text: "'…'", word: null, isString: true });
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
        tokens.push({ text: '$$…$$', word: null, isString: true });
        continue;
      }
    }
    // Double-quoted identifier ("" escapes a quote)
    if (c === '"') {
      let ident = '';
      i++;
      while (i < n) {
        if (sql[i] === '"' && sql[i + 1] === '"') {
          ident += '"';
          i += 2;
          continue;
        }
        if (sql[i] === '"') break;
        ident += sql[i];
        i++;
      }
      if (i >= n) return { tokens, error: 'unterminated quoted identifier' };
      i++; // closing quote
      // A quoted identifier is a NAME, never a keyword — word carries the
      // unquoted text (lowercased) for table-scoping, but it can't match a
      // forbidden KEYWORD because we only test unquoted words for those.
      tokens.push({ text: `"${ident}"`, word: ident.toLowerCase(), isString: false });
      continue;
    }
    // Word (identifier / keyword / number)
    if (/[A-Za-z_0-9]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z_0-9.]/.test(sql[j] as string)) j++;
      const text = sql.slice(i, j);
      tokens.push({ text, word: text.toLowerCase(), isString: false });
      i = j;
      continue;
    }
    // Punctuation — surface `;` `(` `)` `,` individually; collapse other
    // operator chars into single-char tokens (enough for the guards).
    tokens.push({ text: c, word: null, isString: false });
    i++;
  }
  return { tokens, error: null };
}

/** Was this word token written unquoted (so it CAN be a keyword)? */
function isBareWord(t: Token): boolean {
  return !t.isString && t.word !== null && !t.text.startsWith('"');
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

  // Drop a single trailing semicolon; reject anything after it (multi-statement).
  const semis = tokens.filter((t) => t.text === ';');
  if (semis.length > 0) {
    const lastSemi = tokens.lastIndexOf(tokens.filter((t) => t.text === ';').at(-1) as Token);
    const afterLast = tokens.slice(lastSemi + 1);
    if (afterLast.length > 0) {
      return {
        ok: false,
        reason: 'Only a single statement is allowed (no `;`-separated statements).',
      };
    }
    if (semis.length > 1) {
      return {
        ok: false,
        reason: 'Only a single statement is allowed (no `;`-separated statements).',
      };
    }
  }
  const body = tokens.filter((t) => t.text !== ';');
  if (body.length === 0) return { ok: false, reason: 'Empty query.' };

  // First significant token must open a read query. A leading `(` is fine
  // (parenthesised SELECT); skip past leading `(`.
  let k = 0;
  while (k < body.length && body[k]?.text === '(') k++;
  const first = body[k];
  if (!first || first.word === null || !isBareWord(first) || !QUERY_STARTERS.has(first.word)) {
    return {
      ok: false,
      reason: `Only read-only queries are allowed — the statement must begin with SELECT, WITH, FROM, VALUES, TABLE, or DESCRIBE (got "${first?.text ?? '?'}").`,
    };
  }

  // Reject forbidden keywords anywhere (unquoted whole words only).
  for (const t of body) {
    if (isBareWord(t) && t.word !== null && FORBIDDEN_KEYWORDS.has(t.word)) {
      return {
        ok: false,
        reason: `Rejected: "${t.word.toUpperCase()}" is not allowed — the agent may only run read-only SELECT queries, not writes, DDL, PRAGMA, or session statements.`,
      };
    }
  }

  // Reject forbidden file/network/session FUNCTIONS (word immediately followed
  // by `(`, unquoted).
  for (let idx = 0; idx < body.length; idx++) {
    const t = body[idx];
    if (!t || !isBareWord(t) || t.word === null) continue;
    if (FORBIDDEN_FUNCTIONS.has(t.word) && body[idx + 1]?.text === '(') {
      return {
        ok: false,
        reason: `Rejected: the function "${t.word}(…)" can read outside the mounted schema (a local file, a URL, or session state) and is not allowed.`,
      };
    }
  }

  // Collect CTE names defined by WITH … AS ( so they don't trip table-scoping.
  const cteNames = collectCteNames(body);

  // Extract FROM/JOIN table references for scoping + reporting.
  const tables = collectTableRefs(body);
  if (opts.allowedTables) {
    for (const ref of tables) {
      if (cteNames.has(ref)) continue;
      if (!opts.allowedTables.has(ref)) {
        return {
          ok: false,
          reason: `Rejected: "${ref}" is not a mounted table. The agent can only read tables in the current workspace.`,
        };
      }
    }
  }

  return { ok: true, sql, tables: tables.filter((t) => !cteNames.has(t)) };
}

/** Names introduced by `WITH name AS (…)`, `WITH name (cols) AS (…)`, and
 *  comma-separated CTEs. Lowercased, unquoted. */
function collectCteNames(body: Token[]): Set<string> {
  const names = new Set<string>();
  for (let i = 0; i < body.length; i++) {
    const t = body[i];
    if (!t || !isBareWord(t) || t.word !== 'with') continue;
    // Walk the CTE list: <name> [ (cols) ] AS ( … ) [, <name> AS ( … ) ]*
    let j = i + 1;
    if (body[j]?.word === 'recursive') j++;
    while (j < body.length) {
      const nameTok = body[j];
      if (!nameTok || nameTok.word === null) break;
      names.add(nameTok.word);
      j++;
      // Optional column list
      if (body[j]?.text === '(') {
        let depth = 0;
        while (j < body.length) {
          if (body[j]?.text === '(') depth++;
          else if (body[j]?.text === ')') {
            depth--;
            if (depth === 0) {
              j++;
              break;
            }
          }
          j++;
        }
      }
      if (body[j]?.word !== 'as') break;
      j++;
      // Skip the CTE body ( … )
      if (body[j]?.text === '(') {
        let depth = 0;
        while (j < body.length) {
          if (body[j]?.text === '(') depth++;
          else if (body[j]?.text === ')') {
            depth--;
            if (depth === 0) {
              j++;
              break;
            }
          }
          j++;
        }
      }
      if (body[j]?.text === ',') {
        j++;
        continue;
      }
      break;
    }
  }
  return names;
}

/** Table identifiers following FROM / JOIN (lowercased, unquoted, schema-
 *  qualifier stripped to the final segment). A following `(` means a subquery
 *  or table function, not a base-table name, so it's skipped. */
function collectTableRefs(body: Token[]): string[] {
  const refs: string[] = [];
  for (let i = 0; i < body.length; i++) {
    const t = body[i];
    if (!t || !isBareWord(t) || (t.word !== 'from' && t.word !== 'join')) continue;
    const next = body[i + 1];
    if (!next || next.word === null) continue;
    if (next.text === '(') continue; // subquery / derived table
    // A table function like foo(...) — skip (would be caught by FORBIDDEN if
    // dangerous; other TFs aren't base tables to scope).
    if (body[i + 2]?.text === '(') continue;
    // Strip a schema/catalog qualifier (`main.t`, `db.main.t`) to the last part.
    const parts = next.word.split('.');
    const name = parts[parts.length - 1] ?? next.word;
    if (name) refs.push(name);
  }
  return refs;
}
