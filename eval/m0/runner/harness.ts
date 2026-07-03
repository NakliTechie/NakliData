// Facet M0 — browser-side eval runner (the one piece that needs WebGPU + a key).
//
// A STANDALONE harness, not the product shell: it imports the real NakliData
// modules (Engine, mount, the sidecar dispatch, the transformers chunk, and the
// embed-search keeper) and drives every labeled task through them, emitting the
// results.json that scripts/score.py consumes (see ../RESULTS_SCHEMA.md).
//
// It touches no product code — main.ts is untouched — so building it cannot
// regress the app. It cannot be RUN headless (L2 needs a WebGPU browser, C1 a
// BYOK key, L1 a local Ollama), which is exactly what M0 is gated on.
//
// Config + fixture/task files are fetched relative to ../ (the harness page is
// served from eval/m0/runner/). The Playwright driver (run.spec.ts) injects
// window.__M0_CONFIG__ and reads window.__M0_RESULTS__.

import { embedSearchInMemory } from '../../../src/core/embed-search.ts';
import { Engine } from '../../../src/core/engine.ts';
import { mountFile } from '../../../src/core/mount.ts';
import { saveKey } from '../../../src/core/sidecar/byok.ts';
import {
  type SidecarDispatchOpts,
  type SidecarTransport,
  dispatchJob,
} from '../../../src/core/sidecar/client.ts';
import { registerLocalGenerator } from '../../../src/core/sidecar/local-runtime.ts';
import type {
  NlToSqlJob,
  NlToSqlResponse,
  SidecarProvider,
} from '../../../src/core/sidecar/types.ts';
import {
  DEFAULT_EMBED_MODEL_ID,
  DEFAULT_LOCAL_MODEL_ID,
  type Embedder,
  loadEmbedder,
  loadModel,
} from '../../../src/lazy/transformers.ts';

type Rung = 'L1' | 'L2' | 'C1';

interface M0Config {
  rungs: Rung[]; // which rungs to run, e.g. ['L2','C1']
  l1?: { url: string; model: string }; // Ollama OpenAI-compatible endpoint
  // C1 ceiling: either a real provider (key from the page field) OR a
  // same-origin OpenAI-compatible proxy that injects the key server-side
  // (endpoint set → key never enters the browser).
  c1?: { provider: SidecarProvider; model: string; key?: string; endpoint?: string };
  localModel?: string;
  embedModel?: string;
  k?: number;
  nlLimit?: number; // cap NL->SQL tasks (fast probe on the slow WebGPU rung)
  skipSemantic?: boolean; // skip the corpus-embed + semantic tasks
}

interface NlTask {
  id: string;
  intent: string;
  reference_sql?: string;
  must_reject?: boolean;
}
interface SemTask {
  id: string;
  type: 'by-node' | 'by-text';
  query_pid?: string;
  query_text?: string;
  relevant_pids: string[];
}
type ResultRow = Record<string, unknown>;

const FIXTURE_TABLES = ['papers', 'citations', 'authors', 'authorship'];
declare global {
  interface Window {
    __M0_CONFIG__?: M0Config;
    __M0_RESULTS__?: ResultRow[] | undefined;
    __M0_ERROR__?: string | undefined;
    __M0_LOG__?: string[];
    __M0_START?: (cfg?: M0Config) => Promise<void>;
    __M0_PROBE?: (question?: string) => void;
    __M0_PROBE_RESULT__?: { raw?: string; ms?: number; error?: string } | undefined;
  }
}

function log(msg: string) {
  if (!window.__M0_LOG__) window.__M0_LOG__ = [];
  window.__M0_LOG__.push(msg);
  console.log('[m0]', msg);
}

async function fetchText(path: string): Promise<string> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`fetch ${path} -> ${res.status}`);
  return res.text();
}

function parseJsonl<T>(text: string): T[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as T);
}

async function mountFixture(engine: Engine): Promise<void> {
  for (const t of FIXTURE_TABLES) {
    const blob = await (await fetch(`../data/${t}.parquet`)).blob();
    const file = new File([blob], `${t}.parquet`, { type: 'application/octet-stream' });
    await mountFile(engine, file, { tableName: t });
    log(`mounted ${t}`);
  }
}

async function deriveSchema(engine: Engine): Promise<NlToSqlJob['tables']> {
  const tables: NlToSqlJob['tables'] = [];
  for (const name of FIXTURE_TABLES) {
    const cols = await engine.query<{ column_name: string }>(`DESCRIBE ${name}`);
    tables.push({ name, columns: cols.map((c) => c.column_name) });
  }
  return tables;
}

// L1 transport: NakliData's custom provider hard-requires https:// (CSP-tied),
// so we can't point it at a local http Ollama proxy. Inject a transport that
// POSTs to the OpenAI-compatible Ollama endpoint directly. This still runs the
// REAL prompt-building (dispatchJob → buildNlToSqlPrompt) and REAL parsing
// (parseNlToSqlResponse) — only the HTTP leg is swapped. A faithful model test.
const openaiCompatTransport: SidecarTransport = async (req) => {
  const base = (req.endpointUrl ?? '').replace(/\/$/, '');
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: req.model,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
      temperature: 0.3,
      stream: false,
    }),
    ...(req.signal ? { signal: req.signal } : {}),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? '';
};

function rungConfig(rung: Rung, cfg: M0Config): SidecarDispatchOpts {
  if (rung === 'L2') return { provider: 'local', model: cfg.localModel ?? DEFAULT_LOCAL_MODEL_ID };
  if (rung === 'L1') {
    if (!cfg.l1) throw new Error('L1 requested but no cfg.l1');
    return {
      provider: 'custom',
      model: cfg.l1.model,
      customEndpoint: cfg.l1.url,
      transport: openaiCompatTransport,
    };
  }
  if (!cfg.c1) throw new Error('C1 requested but no cfg.c1');
  // Proxied OpenAI-compatible endpoint (e.g. DeepSeek via the dev-server proxy
  // that injects the key): reuse the OpenAI-compatible transport, key-free here.
  if (cfg.c1.endpoint) {
    return {
      provider: 'custom',
      model: cfg.c1.model,
      customEndpoint: cfg.c1.endpoint,
      transport: openaiCompatTransport,
    };
  }
  return { provider: cfg.c1.provider, model: cfg.c1.model };
}

async function runNlToSql(
  engine: Engine,
  tables: NlToSqlJob['tables'],
  tasks: NlTask[],
  rung: Rung,
  cfg: M0Config,
  out: ResultRow[],
): Promise<void> {
  const opts = rungConfig(rung, cfg);
  const limited = cfg.nlLimit ? tasks.slice(0, cfg.nlLimit) : tasks;
  for (const task of limited) {
    const job: NlToSqlJob = { kind: 'nl-to-sql', question: task.intent, tables, dialect: 'duckdb' };
    const t0 = performance.now();
    let sql = '';
    let error: string | null = null;
    try {
      const resp = (await dispatchJob(job, opts)) as NlToSqlResponse;
      sql = resp.sql;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const latency = Math.round(performance.now() - t0);
    // The nl-to-sql parser strips write/DDL statements to '' — so a rejected
    // (safety) generation surfaces as empty sql and is never executed.
    let executed = false;
    let runError: string | null = null;
    if (sql) {
      try {
        await engine.query(sql);
        executed = true;
      } catch (e) {
        runError = e instanceof Error ? e.message : String(e);
      }
    }
    out.push({
      kind: 'nl2sql',
      rung,
      task_id: task.id,
      generated_sql: sql,
      error: error ?? runError,
      executed,
      latency_ms: latency,
    });
  }
  log(`nl2sql ${rung}: ${limited.length} tasks done`);
}

async function buildCorpus(
  engine: Engine,
  embed: Embedder,
): Promise<{ corpus: Array<{ id: string; vec: Float32Array }>; textById: Map<string, string> }> {
  const rows = await engine.query<{ pid: string; ttl: string; abs: string }>(
    'SELECT pid, ttl, abs FROM papers WHERE abs IS NOT NULL AND ttl IS NOT NULL',
  );
  const textById = new Map<string, string>();
  const corpus: Array<{ id: string; vec: Float32Array }> = [];
  const BATCH = 32;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const texts = batch.map((r) => `${r.ttl}. ${r.abs}`);
    batch.forEach((r, j) => textById.set(r.pid, texts[j] as string));
    const vecs = await embed(texts);
    batch.forEach((r, j) => corpus.push({ id: r.pid, vec: vecs[j] as Float32Array }));
    if (i % (BATCH * 8) === 0) log(`embedded ${Math.min(i + BATCH, rows.length)}/${rows.length}`);
  }
  return { corpus, textById };
}

async function runSemantic(
  engine: Engine,
  tasks: SemTask[],
  cfg: M0Config,
  out: ResultRow[],
): Promise<void> {
  const embed = await loadEmbedder(cfg.embedModel ?? DEFAULT_EMBED_MODEL_ID);
  const { corpus, textById } = await buildCorpus(engine, embed);
  const k = cfg.k ?? 10;
  for (const task of tasks) {
    const queryText =
      task.type === 'by-text'
        ? (task.query_text ?? '')
        : (textById.get(task.query_pid ?? '') ?? '');
    if (!queryText) {
      out.push({
        kind: 'semantic',
        rung: 'L2',
        task_id: task.id,
        retrieved_pids: [],
        latency_ms: 0,
      });
      continue;
    }
    const t0 = performance.now();
    // exclude the query paper itself for by-node
    const pool = task.type === 'by-node' ? corpus.filter((c) => c.id !== task.query_pid) : corpus;
    const neighbors = await embedSearchInMemory({ embed, query: queryText, corpus: pool, k });
    out.push({
      kind: 'semantic',
      rung: 'L2',
      task_id: task.id,
      retrieved_pids: neighbors.map((n) => n.id),
      latency_ms: Math.round(performance.now() - t0),
    });
  }
  log(`semantic: ${tasks.length} tasks done`);
}

async function main(): Promise<void> {
  const cfg = window.__M0_CONFIG__;
  if (!cfg) throw new Error('window.__M0_CONFIG__ not set');
  const out: ResultRow[] = [];

  const engine = new Engine();
  await engine.boot({});
  log('engine booted');
  await mountFixture(engine);
  const tables = await deriveSchema(engine);

  const nlTasks = parseJsonl<NlTask>(await fetchText('../tasks/nl2sql.jsonl'));
  const semTasks = parseJsonl<SemTask>(await fetchText('../tasks/semantic.jsonl'));

  // rung prep
  if (cfg.rungs.includes('L2')) {
    const gen = await loadModel(cfg.localModel ?? DEFAULT_LOCAL_MODEL_ID);
    registerLocalGenerator(gen); // main-bundle registration (split-singleton, DECISIONS AJ/AU)
    log('local generator registered');
  }
  // Any 'custom'-provider proxy path (L1 Ollama, or a proxied C1) needs a
  // non-empty key to pass dispatch's gate — the proxy/Ollama injects/ignores
  // the real one, so a placeholder is fine.
  const usesCustomProxy =
    (cfg.rungs.includes('L1') && cfg.l1) || (cfg.rungs.includes('C1') && cfg.c1?.endpoint);
  if (usesCustomProxy) {
    await saveKey('custom', 'proxy-injects-or-ignores-key', false);
  }
  if (cfg.rungs.includes('C1') && cfg.c1 && !cfg.c1.endpoint) {
    // Real provider (Anthropic/OpenAI): key comes from the page's BYOK field so
    // the user types it into their own browser and the driver never reads it.
    const field = document.getElementById('m0-byok-key') as HTMLInputElement | null;
    const key = cfg.c1.key || field?.value || '';
    if (!key) throw new Error('C1 requested but no BYOK key (fill the field on the page)');
    await saveKey(cfg.c1.provider, key, false);
  }

  for (const rung of cfg.rungs) {
    await runNlToSql(engine, tables, nlTasks, rung, cfg, out);
  }
  // semantic runs on L2 only (local WebGPU embeddings — the free-tier gate)
  if (cfg.rungs.includes('L2') && !cfg.skipSemantic) {
    await runSemantic(engine, semTasks, cfg, out);
  }

  window.__M0_RESULTS__ = out;
  log(`DONE — ${out.length} result rows`);
}

// Drivable both ways: the Playwright run.mjs pre-injects window.__M0_CONFIG__
// (auto-runs below); an interactive driver calls window.__M0_START(cfg).
window.__M0_START = (cfg?: M0Config) => {
  if (cfg) window.__M0_CONFIG__ = cfg;
  window.__M0_LOG__ = [];
  window.__M0_RESULTS__ = undefined;
  window.__M0_ERROR__ = undefined;
  return main().catch((e) => {
    window.__M0_ERROR__ = e instanceof Error ? `${e.message}\n${e.stack}` : String(e);
    console.error('[m0] fatal', e);
  });
};
// Direct single-inference probe — bypasses the full loop to answer, fast, the
// one question that matters on L2: coherent SQL vs the slice-B garbage, + the
// real per-generation latency. Result lands on window.__M0_PROBE_RESULT__.
window.__M0_PROBE = (question?: string) => {
  window.__M0_PROBE_RESULT__ = undefined;
  const model = window.__M0_CONFIG__?.localModel ?? DEFAULT_LOCAL_MODEL_ID;
  const q =
    question ??
    'Given DuckDB table papers(pid VARCHAR, ttl VARCHAR, yr BIGINT, n_cite BIGINT), how many papers were published in 2020?';
  (async () => {
    const gen = await loadModel(model);
    registerLocalGenerator(gen);
    const t0 = performance.now();
    const raw = await gen({
      system: 'You translate the question into a single DuckDB SQL query. Output only the SQL.',
      user: q,
      model,
    });
    window.__M0_PROBE_RESULT__ = { raw, ms: Math.round(performance.now() - t0) };
  })().catch((e) => {
    window.__M0_PROBE_RESULT__ = { error: e instanceof Error ? e.message : String(e) };
  });
};
if (window.__M0_CONFIG__) window.__M0_START();
