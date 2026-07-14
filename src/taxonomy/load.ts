// Loads the vendored taxonomy bundle (taxonomy/v0.1/) at app boot.
// The bundle ships in public/taxonomy/v0.1/ so it's reachable at runtime
// via a relative URL.

import type {
  DomainSpec,
  TaxonomyBundle,
  TypeRelationship,
  TypeSpec,
  UniversalLayer,
} from './types.ts';
import { parseUniversalLayer } from './universal.ts';

interface IndexJson {
  format: string;
  version: string;
  released: string;
  domains: Array<{ id: string; label: string; description?: string; domain_file: string }>;
  types_file: string;
  relationships_file: string;
  /** Tier-3 UniversalTerm layer files (optional). */
  universal_file?: string;
  crosswalk_file?: string;
}

let cache: TaxonomyBundle | null = null;

/**
 * Fetcher type — accepts the runtime's Fetch implementation. Engine
 * boundary (v1.3 M0): this module does NOT reach for the browser's
 * global `fetch`; the caller injects one. Browser callers pass
 * `globalThis.fetch.bind(globalThis)`; tests pass a stub.
 */
export type TaxonomyFetcher = (url: string) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

export async function loadTaxonomy(
  base = './taxonomy/v0.1/',
  fetcher?: TaxonomyFetcher,
): Promise<TaxonomyBundle> {
  if (cache) return cache;
  const get = fetcher ?? (globalThis as { fetch: TaxonomyFetcher }).fetch;
  const indexUrl = `${base}index.json`;
  const idxRes = await get(indexUrl);
  if (!idxRes.ok) throw new Error(`Taxonomy index fetch failed: ${idxRes.status} ${indexUrl}`);
  const index = (await idxRes.json()) as IndexJson;

  const typesUrl = `${base}${index.types_file}`;
  const typesRes = await get(typesUrl);
  if (!typesRes.ok) throw new Error(`Taxonomy types fetch failed: ${typesRes.status}`);
  const typesText = await typesRes.text();
  const types: TypeSpec[] = [];
  for (const line of typesText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    types.push(JSON.parse(trimmed) as TypeSpec);
  }

  const domains: DomainSpec[] = [];
  for (const dEntry of index.domains) {
    const dRes = await get(`${base}${dEntry.domain_file}`);
    if (!dRes.ok) {
      console.warn(`[taxonomy] domain fetch failed: ${dEntry.id}`);
      continue;
    }
    const dSpec = (await dRes.json()) as DomainSpec;
    domains.push(dSpec);
  }

  // Relationships are optional metadata — used by the schema-graph view
  // but not by classification. Don't fail the whole bundle load if the
  // file is missing or malformed; just leave the field undefined.
  let relationships: TypeRelationship[] | undefined;
  if (index.relationships_file) {
    try {
      const rRes = await get(`${base}${index.relationships_file}`);
      if (rRes.ok) {
        const rJson = (await rRes.json()) as { relationships?: TypeRelationship[] };
        relationships = rJson.relationships;
      } else {
        console.warn(`[taxonomy] relationships fetch failed: ${rRes.status}`);
      }
    } catch (err) {
      console.warn('[taxonomy] relationships parse failed', err);
    }
  }

  // Tier-3 UniversalTerm layer — optional. Two JSONL files (concepts +
  // crosswalk). Parsed by the pure `universal.ts` module. Missing files leave
  // the field undefined (resolvers then fall back to `'public'` / `null`).
  let universal: UniversalLayer | undefined;
  if (index.universal_file && index.crosswalk_file) {
    try {
      const [uRes, cRes] = await Promise.all([
        get(`${base}${index.universal_file}`),
        get(`${base}${index.crosswalk_file}`),
      ]);
      if (uRes.ok && cRes.ok) {
        universal = parseUniversalLayer(await uRes.text(), await cRes.text());
      } else {
        console.warn(`[taxonomy] universal-layer fetch failed: ${uRes.status}/${cRes.status}`);
      }
    } catch (err) {
      console.warn('[taxonomy] universal-layer parse failed', err);
    }
  }

  cache = {
    version: index.version,
    released: index.released,
    domains,
    types,
    ...(relationships ? { relationships } : {}),
    ...(universal ? { universal } : {}),
  };
  return cache;
}

export function clearTaxonomyCache(): void {
  cache = null;
}
