import { assertSafeBearerToken } from '../core/bearer-token.ts';
import { RemoteResponseError, readBoundedJson, readBoundedText } from '../core/remote-response.ts';
import { redactSecrets } from '../core/sidecar/providers/redact.ts';

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_JSON_LIMIT = 2 * 1024 * 1024;
const DEFAULT_PAGE_LIMIT = 100;
const ERROR_BODY_LIMIT = 16 * 1024;

export interface IcebergCatalogClientOptions {
  catalogUrl: string;
  bearerToken: string | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxJsonBytes?: number;
  maxPages?: number;
}

export interface IcebergRequestOptions {
  signal?: AbortSignal;
}

export interface TableIdentifier {
  namespace: string[];
  name: string;
}

export interface LoadTableResult {
  metadataLocation: string;
}

export class IcebergCatalogError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code = 'catalog_error') {
    super(message);
    this.name = 'IcebergCatalogError';
    this.status = status;
    this.code = code;
  }
}

export class IcebergCatalogClient {
  private readonly catalogUrl: string;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxJsonBytes: number;
  private readonly maxPages: number;

  constructor(opts: IcebergCatalogClientOptions) {
    if (!opts.catalogUrl.trim()) throw new Error('Catalog URL is required.');
    this.catalogUrl = opts.catalogUrl.trim().replace(/\/+$/, '');
    this.headers = { Accept: 'application/json' };
    if (opts.bearerToken) {
      assertSafeBearerToken(opts.bearerToken);
      this.headers.Authorization = `Bearer ${opts.bearerToken}`;
    }
    this.fetchImpl = opts.fetchImpl ?? fetch.bind(globalThis);
    this.timeoutMs = positiveLimit(opts.timeoutMs, DEFAULT_TIMEOUT_MS);
    this.maxJsonBytes = positiveLimit(opts.maxJsonBytes, DEFAULT_JSON_LIMIT);
    this.maxPages = positiveLimit(opts.maxPages, DEFAULT_PAGE_LIMIT);
  }

  async config(
    options: IcebergRequestOptions = {},
  ): Promise<{ defaults: Record<string, string>; overrides: Record<string, string> }> {
    const data = objectValue(await this.get('/v1/config', options), 'config response');
    return {
      defaults: stringRecord(data.defaults ?? {}, 'defaults'),
      overrides: stringRecord(data.overrides ?? {}, 'overrides'),
    };
  }

  async listNamespaces(options: IcebergRequestOptions = {}): Promise<string[][]> {
    const namespaces: string[][] = [];
    let pageToken: string | null = null;
    for (let page = 0; page < this.maxPages; page++) {
      const data = objectValue(
        await this.get(withPageToken('/v1/namespaces', pageToken), options),
        'namespace listing',
      );
      if (!Array.isArray(data.namespaces)) {
        throw new IcebergCatalogError(
          'Catalog namespace response is missing namespaces[].',
          200,
          'invalid_catalog',
        );
      }
      for (const [index, value] of data.namespaces.entries()) {
        namespaces.push(stringArray(value, `namespaces[${index}]`));
      }
      pageToken = nextPageToken(data);
      if (!pageToken) return namespaces;
    }
    throw new IcebergCatalogError(
      `Catalog namespace listing exceeded ${this.maxPages} pages.`,
      200,
      'pagination_limit',
    );
  }

  async listTables(namespace: string, options: IcebergRequestOptions = {}): Promise<string[]> {
    const tables: string[] = [];
    let pageToken: string | null = null;
    const base = `/v1/namespaces/${encodeNamespace(namespace)}/tables`;
    for (let page = 0; page < this.maxPages; page++) {
      const data = objectValue(
        await this.get(withPageToken(base, pageToken), options),
        'table listing',
      );
      if (!Array.isArray(data.identifiers)) {
        throw new IcebergCatalogError(
          'Catalog table response is missing identifiers[].',
          200,
          'invalid_catalog',
        );
      }
      for (const [index, value] of data.identifiers.entries()) {
        const identifier = objectValue(value, `identifiers[${index}]`);
        stringArray(identifier.namespace, `identifiers[${index}].namespace`);
        tables.push(stringValue(identifier.name, `identifiers[${index}].name`));
      }
      pageToken = nextPageToken(data);
      if (!pageToken) return tables;
    }
    throw new IcebergCatalogError(
      `Catalog table listing exceeded ${this.maxPages} pages.`,
      200,
      'pagination_limit',
    );
  }

  async loadTable(
    namespace: string,
    table: string,
    options: IcebergRequestOptions = {},
  ): Promise<LoadTableResult> {
    const data = objectValue(
      await this.get(
        `/v1/namespaces/${encodeNamespace(namespace)}/tables/${encodeURIComponent(table)}`,
        options,
      ),
      'load-table response',
    );
    const location = data['metadata-location'] ?? data.metadataLocation;
    if (typeof location !== 'string' || !location.trim()) {
      throw new IcebergCatalogError(
        `Catalog response for ${namespace}.${table} is missing the metadata-location field.`,
        200,
        'invalid_catalog',
      );
    }
    return { metadataLocation: location.trim() };
  }

  private async get(path: string, options: IcebergRequestOptions): Promise<unknown> {
    return await this.withResponse(path, options.signal, async (response) => {
      if (!response.ok) throw await this.toCatalogError(response);
      try {
        return await readBoundedJson(response, this.maxJsonBytes);
      } catch (error) {
        if (error instanceof RemoteResponseError) {
          throw new IcebergCatalogError(
            `Catalog response rejected: ${error.message}`,
            response.status,
            error.code,
          );
        }
        throw error;
      }
    });
  }

  private async withResponse<T>(
    path: string,
    signal: AbortSignal | undefined,
    consume: (response: Response) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    let timedOut = false;
    const abortFromExternal = () => controller.abort(signal?.reason);
    if (signal?.aborted) abortFromExternal();
    else signal?.addEventListener('abort', abortFromExternal, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort('deadline exceeded');
    }, this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.catalogUrl}${path}`, {
        method: 'GET',
        headers: this.headers,
        signal: controller.signal,
      });
      return await consume(response);
    } catch (error) {
      if (controller.signal.aborted) {
        throw new IcebergCatalogError(
          timedOut
            ? `Catalog request exceeded ${this.timeoutMs} ms.`
            : 'Catalog request cancelled.',
          0,
          timedOut ? 'timeout' : 'cancelled',
        );
      }
      if (error instanceof IcebergCatalogError) throw error;
      throw new IcebergCatalogError(
        `Catalog network error: ${error instanceof Error ? error.message : String(error)}`,
        0,
        'network_error',
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abortFromExternal);
    }
  }

  private async toCatalogError(response: Response): Promise<IcebergCatalogError> {
    let message = `Catalog ${response.status}: ${response.statusText || 'request failed'}`;
    try {
      const text = redactSecrets((await readBoundedText(response, ERROR_BODY_LIMIT)).slice(0, 240));
      if (text) message = `Catalog ${response.status}: ${text}`;
    } catch {
      // Keep the status-only error when the body cannot be read safely.
    }
    return new IcebergCatalogError(message, response.status);
  }
}

function encodeNamespace(namespace: string): string {
  return namespace
    .split('.')
    .map((part) => encodeURIComponent(part))
    .join('%1F');
}

function withPageToken(path: string, token: string | null): string {
  return token ? `${path}?pageToken=${encodeURIComponent(token)}` : path;
}

function nextPageToken(data: Record<string, unknown>): string | null {
  const value = data['next-page-token'] ?? data.nextPageToken;
  if (value === null || value === undefined || value === '') return null;
  return stringValue(value, 'next-page-token');
}

function objectValue(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new IcebergCatalogError(`Catalog ${path} must be an object.`, 200, 'invalid_catalog');
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new IcebergCatalogError(
      `Catalog ${path} must be a non-empty string.`,
      200,
      'invalid_catalog',
    );
  }
  return value.trim();
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new IcebergCatalogError(
      `Catalog ${path} must be an array of strings.`,
      200,
      'invalid_catalog',
    );
  }
  return value.map((item) => (item as string).trim());
}

function stringRecord(value: unknown, path: string): Record<string, string> {
  const object = objectValue(value, path);
  for (const [key, item] of Object.entries(object)) {
    if (typeof item !== 'string') {
      throw new IcebergCatalogError(
        `Catalog ${path}.${key} must be a string.`,
        200,
        'invalid_catalog',
      );
    }
  }
  return object as Record<string, string>;
}

function positiveLimit(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}
