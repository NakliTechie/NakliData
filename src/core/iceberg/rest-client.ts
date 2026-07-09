// Apache Iceberg REST Catalog client — slice 3b.
//
// Implements just enough of the REST OpenAPI surface for the
// table-picker flow: GET /v1/config (server info), GET /v1/namespaces
// (list namespaces), GET /v1/namespaces/{ns}/tables (list tables in a
// namespace), GET /v1/namespaces/{ns}/tables/{table} (resolve
// metadata-location). OAuth2 device flow and AWS SigV4 are out of
// scope for this slice — Bearer-token auth only.
//
// Reference: https://iceberg.apache.org/spec/rest-catalog-open-api.yaml

import { assertSafeBearerToken } from '../bearer-token.ts';
import { redactSecrets } from '../sidecar/providers/redact.ts';

export interface IcebergCatalogClientOptions {
  /** Base URL of the catalog — e.g. `https://lakehouse.example.com/iceberg`. */
  catalogUrl: string;
  /** Optional Bearer token. Omitted entirely when null. */
  bearerToken: string | null;
  /** Override fetch — handy for tests. */
  fetchImpl?: typeof fetch;
}

export interface NamespaceListing {
  namespaces: string[][];
}

export interface TableIdentifier {
  namespace: string[];
  name: string;
}

export interface TableListing {
  identifiers: TableIdentifier[];
}

export interface LoadTableResult {
  metadataLocation: string;
  // We expose only the bits we use — full metadata object is verbose.
}

export class IcebergCatalogError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'IcebergCatalogError';
    this.status = status;
  }
}

export class IcebergCatalogClient {
  private readonly catalogUrl: string;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: IcebergCatalogClientOptions) {
    if (!opts.catalogUrl.trim()) throw new Error('Catalog URL is required.');
    // Trim trailing slashes — every path we build starts with /v1/...
    this.catalogUrl = opts.catalogUrl.trim().replace(/\/+$/, '');
    this.headers = { Accept: 'application/json' };
    if (opts.bearerToken) {
      // L29: validate before building the header (CR/LF etc.), matching
      // BridgeClient + engine.configureIceberg — this site was missed.
      assertSafeBearerToken(opts.bearerToken);
      this.headers.Authorization = `Bearer ${opts.bearerToken}`;
    }
    this.fetchImpl = opts.fetchImpl ?? fetch.bind(globalThis);
  }

  /**
   * Probe the catalog. Returns the server's `defaults` + `overrides`
   * properties (per the REST spec). Mostly a health check — confirms
   * the catalog is reachable and the auth header is accepted.
   */
  async config(): Promise<{ defaults: Record<string, string>; overrides: Record<string, string> }> {
    return this.get('/v1/config') as Promise<{
      defaults: Record<string, string>;
      overrides: Record<string, string>;
    }>;
  }

  /**
   * List namespaces. Iceberg supports nested namespaces (e.g.
   * `db.schema.table`), encoded as a path-segment array in the
   * response. For slice 3b we surface them as joined strings (`db.schema`)
   * — the UI lets the user pick one as an opaque token.
   */
  async listNamespaces(): Promise<string[][]> {
    const data = (await this.get('/v1/namespaces')) as NamespaceListing;
    return data.namespaces ?? [];
  }

  /**
   * List tables in a namespace. Namespace is supplied as a
   * dot-separated string; we URL-encode it as a single path segment
   * per the REST spec's "unit-separator" convention (each level
   * percent-encoded but joined by `%1F`). For single-level namespaces
   * the result is the same as a plain path segment.
   */
  async listTables(namespace: string): Promise<string[]> {
    const data = (await this.get(
      `/v1/namespaces/${encodeNamespace(namespace)}/tables`,
    )) as TableListing;
    return (data.identifiers ?? []).map((id) => id.name);
  }

  /**
   * Resolve a table's metadata-location. The catalog returns the
   * `metadata-location` (URL of the active metadata.json) plus the
   * inline metadata object; we just need the location to hand off to
   * the iceberg_scan path.
   */
  async loadTable(namespace: string, table: string): Promise<LoadTableResult> {
    const data = (await this.get(
      `/v1/namespaces/${encodeNamespace(namespace)}/tables/${encodeURIComponent(table)}`,
    )) as { 'metadata-location'?: string; metadataLocation?: string };
    // Some catalogs use kebab-case ("metadata-location"), some camelCase.
    const loc = data['metadata-location'] ?? data.metadataLocation;
    if (!loc) {
      throw new IcebergCatalogError(
        `Catalog response for ${namespace}.${table} is missing the metadata-location field.`,
        200,
      );
    }
    return { metadataLocation: loc };
  }

  private async get(path: string): Promise<unknown> {
    const res = await this.fetchImpl(`${this.catalogUrl}${path}`, {
      method: 'GET',
      headers: this.headers,
    });
    if (!res.ok) {
      const text = await safeReadText(res);
      throw new IcebergCatalogError(
        `Catalog ${res.status}: ${text || res.statusText || 'request failed'}`,
        res.status,
      );
    }
    return (await res.json()) as unknown;
  }
}

/**
 * Per Iceberg REST OpenAPI: nested namespaces are joined by the
 * unit-separator character (U+001F) when collapsed into a single path
 * segment. Each level is percent-encoded first.
 */
function encodeNamespace(namespace: string): string {
  return namespace
    .split('.')
    .map((part) => encodeURIComponent(part))
    .join('%1F');
}

async function safeReadText(res: Response): Promise<string> {
  try {
    // M14: cap + redact — a misconfigured proxy that echoes the Authorization
    // header in the error body would otherwise surface the bearer token in the
    // mount modal. Matches the sidecar providers' error handling.
    return redactSecrets((await res.text()).slice(0, 240));
  } catch {
    return '';
  }
}
