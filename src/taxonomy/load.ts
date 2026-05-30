// Loads the vendored taxonomy bundle (taxonomy/v0.1/) at app boot.
// The bundle ships in public/taxonomy/v0.1/ so it's reachable at runtime
// via a relative URL.

import type { DomainSpec, TaxonomyBundle, TypeRelationship, TypeSpec } from './types.ts';

interface IndexJson {
  format: string;
  version: string;
  released: string;
  domains: Array<{ id: string; label: string; description?: string; domain_file: string }>;
  types_file: string;
  relationships_file: string;
}

let cache: TaxonomyBundle | null = null;

export async function loadTaxonomy(base = './taxonomy/v0.1/'): Promise<TaxonomyBundle> {
  if (cache) return cache;
  const indexUrl = `${base}index.json`;
  const idxRes = await fetch(indexUrl);
  if (!idxRes.ok) throw new Error(`Taxonomy index fetch failed: ${idxRes.status} ${indexUrl}`);
  const index = (await idxRes.json()) as IndexJson;

  const typesUrl = `${base}${index.types_file}`;
  const typesRes = await fetch(typesUrl);
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
    const dRes = await fetch(`${base}${dEntry.domain_file}`);
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
      const rRes = await fetch(`${base}${index.relationships_file}`);
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

  cache = {
    version: index.version,
    released: index.released,
    domains,
    types,
    ...(relationships ? { relationships } : {}),
  };
  return cache;
}

export function clearTaxonomyCache(): void {
  cache = null;
}
