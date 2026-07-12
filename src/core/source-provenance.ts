// Dataset provenance (Tier-2 / reporting-improvements #10). Turns a mounted
// source into a human-readable provenance record — kind, location (URL / bucket
// / catalog ref), host, and its tables (name · format · rows) — for two uses:
//   1. a one-line tooltip on each source card, and
//   2. an auto-generated "Sources" block in a report's notes, so a report
//      carries where its data came from.
// Pure: no DOM, no engine. Secrets are never part of a source's persisted
// config, so nothing sensitive can leak here.

import type { MountedSource } from './mount.ts';

export interface SourceProvenanceItem {
  label: string;
  /** Human label for the source kind ("Public URL", "Local file", …). */
  kindLabel: string;
  /** URL / bucket / catalog ref, or null for local (per-table origin instead). */
  location: string | null;
  /** Host for URL sources (derived from location), else null. */
  host: string | null;
  tables: Array<{ name: string; format: string; rowCount: number }>;
}

const KIND_LABEL: Record<MountedSource['kind'], string> = {
  'example-bundle': 'Example dataset',
  'fsa-folder': 'Local folder',
  'fsa-file': 'Local file',
  http: 'Public URL',
  's3-endpoint': 'S3 bucket',
  'iceberg-table': 'Iceberg table',
  'iceberg-catalog': 'Iceberg catalog',
  'compute-bridge': 'Compute bridge',
  'compute-bridge-catalog': 'Compute bridge',
};

/** Best-effort host from a URL string; null when it doesn't parse. */
function hostOf(url: string): string | null {
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
}

/** The source's remote location string (URL / bucket / catalog ref), or null. */
function locationOf(src: MountedSource): string | null {
  switch (src.kind) {
    case 'http':
      return src.ref ?? null;
    case 's3-endpoint':
      return src.s3 ? `s3://${src.s3.bucket}/${src.s3.pathPrefix ?? ''}` : null;
    case 'iceberg-table':
      return src.iceberg?.metadataUrl ?? null;
    case 'iceberg-catalog':
      return src.icebergCatalog
        ? `${src.icebergCatalog.catalogUrl} · ${src.icebergCatalog.namespace}.${src.icebergCatalog.table}`
        : null;
    case 'compute-bridge':
      return src.bridge?.bridgeUrl ?? null;
    case 'compute-bridge-catalog':
      return src.bridgeCatalog?.bridgeUrl ?? null;
    default:
      return null; // local (fsa) / example — table.origin carries the path
  }
}

export function describeSource(src: MountedSource): SourceProvenanceItem {
  const location = locationOf(src);
  return {
    label: src.label,
    kindLabel: KIND_LABEL[src.kind] ?? src.kind,
    location,
    host: location ? hostOf(location) : null,
    tables: src.tables.map((t) => ({ name: t.name, format: t.format, rowCount: t.rowCount })),
  };
}

/** One-line provenance summary for a source-card tooltip. */
export function provenanceSummary(src: MountedSource): string {
  const p = describeSource(src);
  const loc = p.host ?? p.location;
  return loc ? `${p.kindLabel} · ${loc}` : p.kindLabel;
}

/**
 * A "Sources" markdown block for a report's notes. Lists each mounted source
 * with its location + tables. Returns '' when there are no sources.
 */
export function provenanceMarkdown(sources: MountedSource[]): string {
  if (sources.length === 0) return '';
  const lines: string[] = ['### Sources', ''];
  for (const src of sources) {
    const p = describeSource(src);
    const loc = p.location ? ` — \`${p.location}\`` : '';
    lines.push(`- **${p.label}** (${p.kindLabel})${loc}`);
    for (const t of p.tables) {
      lines.push(`  - ${t.name} · ${t.format} · ${t.rowCount.toLocaleString()} rows`);
    }
  }
  return lines.join('\n');
}
