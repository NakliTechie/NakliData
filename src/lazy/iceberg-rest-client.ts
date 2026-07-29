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
  /** Optional warehouse/catalog identifier sent only to GET /v1/config. */
  warehouse?: string | null;
  /**
   * Advertise support for receiving short-lived storage credentials.
   * Defaults to none so a caller cannot accidentally claim a capability it
   * has not wired into its data plane.
   */
  accessDelegation?: 'none' | 'vended-credentials';
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

export interface IcebergCatalogConfiguration {
  defaults: Record<string, string>;
  overrides: Record<string, string>;
  resolved: Record<string, string>;
  endpoints: string[] | null;
  prefix: string | null;
  namespaceSeparator: string;
}

export interface VendedCredentialMetadata {
  requested: boolean;
  provided: boolean;
  providers: string[];
  expiresAtMs: number | null;
  configKeys: string[];
  storageCredentialCount: number;
}

export type VendedCredentialProvider = 's3' | 'gcs' | 'azure' | 'unknown';

/**
 * Secret-bearing access is only handed to a trusted data-plane target during
 * `replace()`. It is never enumerable on a catalog result or persisted.
 */
export interface VendedStorageCredential {
  provider: VendedCredentialProvider;
  prefix: string | null;
  config: Readonly<Record<string, string>>;
}

export interface VendedCredentialTarget {
  /** Atomically replace all active table-scoped credentials. */
  replace(credentials: readonly VendedStorageCredential[]): Promise<void>;
  /** Clear any partially or previously applied credentials. */
  clear(): Promise<void>;
}

export interface CredentialApplyOptions {
  nowMs?: number;
  /** Refuse credentials that will expire before a bounded read can start. */
  minValidityMs?: number;
}

const DEFAULT_MIN_CREDENTIAL_VALIDITY_MS = 60_000;

/**
 * Opaque, revocable storage access. `#entries` are true JS private slots, so
 * JSON/string spread/structured enumeration cannot copy credential values.
 */
export class VendedCredentialLease {
  #entries: VendedStorageCredential[];
  readonly expiresAtMs: number | null;

  constructor(entries: VendedStorageCredential[], expiresAtMs: number | null) {
    this.#entries = entries.map((entry) => ({
      provider: entry.provider,
      prefix: entry.prefix,
      config: { ...entry.config },
    }));
    this.expiresAtMs = expiresAtMs;
  }

  get revoked(): boolean {
    return this.#entries.length === 0;
  }

  needsRefresh(nowMs = Date.now(), minValidityMs = DEFAULT_MIN_CREDENTIAL_VALIDITY_MS): boolean {
    const normalizedNowMs = credentialNow(nowMs);
    const normalizedMinValidityMs = credentialMinValidity(minValidityMs);
    return (
      this.revoked ||
      this.expiresAtMs === null ||
      !Number.isSafeInteger(this.expiresAtMs) ||
      this.expiresAtMs <= 0 ||
      this.expiresAtMs <= normalizedNowMs + normalizedMinValidityMs
    );
  }

  revoke(): void {
    this.#entries = [];
  }

  async applyTo(
    target: VendedCredentialTarget,
    options: CredentialApplyOptions = {},
  ): Promise<void> {
    const nowMs = credentialNow(options.nowMs);
    const minValidityMs = credentialMinValidity(options.minValidityMs);
    if (this.revoked) {
      throw new IcebergCatalogError(
        'Vended credentials have been revoked.',
        0,
        'credential_revoked',
      );
    }
    if (this.needsRefresh(nowMs, minValidityMs)) {
      throw new IcebergCatalogError(
        'Vended credentials are missing a usable expiry or need refresh.',
        0,
        'credential_refresh_required',
      );
    }
    for (const entry of this.#entries) validateCredentialEntry(entry);
    const credentials = this.#entries.map((entry) => ({
      provider: entry.provider,
      prefix: entry.prefix,
      config: { ...entry.config },
    }));
    try {
      await target.replace(credentials);
    } catch {
      try {
        await target.clear();
      } catch {
        // Keep the original fail-closed application error.
      }
      throw new IcebergCatalogError(
        'Vended credential application failed; the target was cleared.',
        0,
        'credential_apply_failed',
      );
    }
  }

  /** Defensive safe serialization if a lease is ever logged directly. */
  toJSON(): Record<string, unknown> {
    return {
      opaque: true,
      expiresAtMs: this.expiresAtMs,
      credentialCount: this.#entries.length,
      revoked: this.revoked,
    };
  }
}

export interface LoadTableResult {
  metadataLocation: string;
  /**
   * Non-secret description of table-scoped access returned by the catalog.
   * Credential values and storage prefixes are deliberately not exposed.
   */
  credentialVending: VendedCredentialMetadata;
  /**
   * Non-enumerable secret capability. Callers can apply it to a trusted,
   * in-memory data-plane target but cannot accidentally serialize/spread it.
   */
  credentialLease: VendedCredentialLease | null;
}

export interface AppliedTableAccess {
  metadataLocation: string;
  credentialVending: VendedCredentialMetadata;
}

/**
 * Refresh owner for one table. A near-expiry lease is revoked and replaced by
 * a fresh load-table response before any target sees credential values.
 */
export class VendedCredentialSession {
  #current: LoadTableResult | null = null;
  #target: VendedCredentialTarget | null = null;
  readonly #load: () => Promise<LoadTableResult>;

  constructor(load: () => Promise<LoadTableResult>) {
    this.#load = load;
  }

  async applyTo(
    target: VendedCredentialTarget,
    options: CredentialApplyOptions = {},
  ): Promise<AppliedTableAccess> {
    const nowMs = credentialNow(options.nowMs);
    const minValidityMs = credentialMinValidity(options.minValidityMs);
    if (this.#target && this.#target !== target) {
      await clearCredentialTarget(this.#target);
      this.#target = null;
    }
    if (
      !this.#current?.credentialLease ||
      this.#current.credentialLease.needsRefresh(nowMs, minValidityMs)
    ) {
      this.#current?.credentialLease?.revoke();
      try {
        this.#current = await this.#load();
      } catch (error) {
        await clearCredentialTarget(target);
        this.#target = null;
        this.#current = null;
        throw error;
      }
    }
    const lease = this.#current.credentialLease;
    if (!lease) {
      await clearCredentialTarget(target);
      this.#target = null;
      throw new IcebergCatalogError(
        'Catalog did not provide vended storage credentials.',
        0,
        'credentials_not_provided',
      );
    }
    try {
      await lease.applyTo(target, { nowMs, minValidityMs });
    } catch (error) {
      await clearCredentialTarget(target);
      this.#target = null;
      throw error;
    }
    this.#target = target;
    return {
      metadataLocation: this.#current.metadataLocation,
      credentialVending: this.#current.credentialVending,
    };
  }

  async revoke(): Promise<void> {
    this.#current?.credentialLease?.revoke();
    this.#current = null;
    if (!this.#target) return;
    await clearCredentialTarget(this.#target);
    this.#target = null;
  }
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
  private readonly warehouse: string | null;
  private readonly accessDelegation: 'none' | 'vended-credentials';
  private configuration: IcebergCatalogConfiguration | null = null;
  private configurationPromise: Promise<IcebergCatalogConfiguration> | null = null;

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
    this.warehouse = opts.warehouse?.trim() || null;
    this.accessDelegation = opts.accessDelegation ?? 'none';
  }

  async config(options: IcebergRequestOptions = {}): Promise<IcebergCatalogConfiguration> {
    if (this.configuration) return this.configuration;
    if (!this.configurationPromise) {
      this.configurationPromise = this.fetchConfiguration(options).catch((error) => {
        this.configurationPromise = null;
        throw error;
      });
    }
    return await this.configurationPromise;
  }

  async listNamespaces(options: IcebergRequestOptions = {}): Promise<string[][]> {
    const configuration = await this.config(options);
    requireEndpoint(configuration, 'GET /v1/{prefix}/namespaces');
    const namespaces: string[][] = [];
    let pageToken: string | null = null;
    for (let page = 0; page < this.maxPages; page++) {
      const data = objectValue(
        await this.get(
          withPageToken(catalogPath(configuration.prefix, '/namespaces'), pageToken),
          options,
        ),
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
    const configuration = await this.config(options);
    requireEndpoint(configuration, 'GET /v1/{prefix}/namespaces/{namespace}/tables');
    const tables: string[] = [];
    let pageToken: string | null = null;
    const base = catalogPath(
      configuration.prefix,
      `/namespaces/${encodeNamespace(namespace, configuration.namespaceSeparator)}/tables`,
    );
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
    const configuration = await this.config(options);
    requireEndpoint(configuration, 'GET /v1/{prefix}/namespaces/{namespace}/tables/{table}');
    const delegationHeaders =
      this.accessDelegation === 'vended-credentials'
        ? { 'X-Iceberg-Access-Delegation': 'vended-credentials' }
        : {};
    const data = objectValue(
      await this.get(
        catalogPath(
          configuration.prefix,
          `/namespaces/${encodeNamespace(namespace, configuration.namespaceSeparator)}/tables/${encodeURIComponent(table)}`,
        ),
        options,
        delegationHeaders,
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
    const metadataLocation = location.trim();
    const access = credentialAccess(
      data,
      this.accessDelegation === 'vended-credentials',
      metadataLocation,
    );
    const result = {
      metadataLocation,
      credentialVending: access.metadata,
    } as LoadTableResult;
    Object.defineProperty(result, 'credentialLease', {
      value: access.lease,
      enumerable: false,
      writable: false,
    });
    return result;
  }

  credentialSession(
    namespace: string,
    table: string,
    options: IcebergRequestOptions = {},
  ): VendedCredentialSession {
    return new VendedCredentialSession(() => this.loadTable(namespace, table, options));
  }

  private async fetchConfiguration(
    options: IcebergRequestOptions,
  ): Promise<IcebergCatalogConfiguration> {
    const path = this.warehouse
      ? `/v1/config?warehouse=${encodeURIComponent(this.warehouse)}`
      : '/v1/config';
    const data = objectValue(await this.get(path, options), 'config response');
    const defaults = stringRecord(data.defaults ?? {}, 'defaults');
    const overrides = stringRecord(data.overrides ?? {}, 'overrides');
    const resolved: Record<string, string> = {
      ...defaults,
      ...(this.warehouse ? { warehouse: this.warehouse } : {}),
      ...overrides,
    };
    const configuration: IcebergCatalogConfiguration = {
      defaults,
      overrides,
      resolved,
      endpoints:
        data.endpoints === undefined ? null : stringArray(data.endpoints, 'config endpoints'),
      prefix: normalizeCatalogPrefix(resolved.prefix),
      namespaceSeparator: normalizeNamespaceSeparator(resolved['namespace-separator']),
    };
    this.configuration = configuration;
    return configuration;
  }

  private async get(
    path: string,
    options: IcebergRequestOptions,
    extraHeaders: Record<string, string> = {},
  ): Promise<unknown> {
    return await this.withResponse(path, options.signal, extraHeaders, async (response) => {
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
    extraHeaders: Record<string, string>,
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
        headers: { ...this.headers, ...extraHeaders },
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

function encodeNamespace(namespace: string, separator: string): string {
  return namespace
    .split('.')
    .map((part) => encodeURIComponent(part))
    .join(separator);
}

function catalogPath(prefix: string | null, suffix: string): string {
  return `/v1/${prefix ? `${encodeCatalogPrefix(prefix)}/` : ''}${suffix.replace(/^\/+/, '')}`;
}

function encodeCatalogPrefix(prefix: string): string {
  return prefix
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
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

function normalizeCatalogPrefix(value: string | undefined): string | null {
  if (value === undefined || value.trim() === '') return null;
  const prefix = value.trim().replace(/^\/+|\/+$/g, '');
  const parts = prefix.split('/');
  if (
    parts.length === 0 ||
    parts.some(
      (part) =>
        !part ||
        part === '.' ||
        part === '..' ||
        /[\\?#]/.test(part) ||
        containsControlCharacter(part),
    )
  ) {
    throw new IcebergCatalogError(
      'Catalog config prefix is not a safe relative path.',
      200,
      'invalid_catalog',
    );
  }
  return prefix;
}

function normalizeNamespaceSeparator(value: string | undefined): string {
  const separator = value?.trim() || '%1F';
  let decoded: string;
  try {
    decoded = decodeURIComponent(separator);
  } catch {
    throw new IcebergCatalogError(
      'Catalog namespace-separator is not valid URL encoding.',
      200,
      'invalid_catalog',
    );
  }
  const decodedCharacters = [...decoded];
  const decodedCode = decodedCharacters[0]?.codePointAt(0) ?? 0;
  if (
    separator.length > 12 ||
    /[/?#\\]/.test(separator) ||
    containsControlCharacter(separator) ||
    /%(?![0-9a-f]{2})/i.test(separator) ||
    decodedCharacters.length !== 1 ||
    decoded === '.' ||
    /[/?#\\]/.test(decoded) ||
    (decodedCode <= 0x1f && decodedCode !== 0x1f) ||
    decodedCode === 0x7f
  ) {
    throw new IcebergCatalogError(
      'Catalog namespace-separator is not safe for a path segment.',
      200,
      'invalid_catalog',
    );
  }
  return separator;
}

function requireEndpoint(configuration: IcebergCatalogConfiguration, expected: string): void {
  if (configuration.endpoints === null) return;
  const withoutPrefix = expected.replace('/{prefix}', '');
  if (
    !configuration.endpoints.includes(expected) &&
    !(configuration.prefix === null && configuration.endpoints.includes(withoutPrefix))
  ) {
    throw new IcebergCatalogError(
      `Catalog does not advertise the required endpoint: ${expected}.`,
      200,
      'unsupported_endpoint',
    );
  }
}

function credentialAccess(
  data: Record<string, unknown>,
  requested: boolean,
  metadataLocation: string,
): { metadata: VendedCredentialMetadata; lease: VendedCredentialLease | null } {
  const tableConfig = stringRecord(data.config ?? {}, 'load-table config');
  const rawCredentials = data['storage-credentials'] ?? [];
  if (!Array.isArray(rawCredentials)) {
    throw new IcebergCatalogError(
      'Catalog storage-credentials must be an array.',
      200,
      'invalid_catalog',
    );
  }
  const providers = new Set<string>();
  const configKeys = new Set<string>(Object.keys(tableConfig));
  const expirations: number[] = [];
  const entries: VendedStorageCredential[] = [];
  let hasStorageCredential = false;

  detectProvider('', tableConfig, providers);
  collectExpiration(tableConfig, expirations);
  if (requested && Object.keys(tableConfig).some(isCredentialKey)) {
    entries.push({
      provider: providerFor(metadataLocation, tableConfig),
      prefix: null,
      config: tableConfig,
    });
  }
  for (const [index, raw] of rawCredentials.entries()) {
    const credential = objectValue(raw, `storage-credentials[${index}]`);
    const prefix = stringValue(credential.prefix, `storage-credentials[${index}].prefix`);
    const config = stringRecord(credential.config, `storage-credentials[${index}].config`);
    for (const key of Object.keys(config)) configKeys.add(key);
    detectProvider(prefix, config, providers);
    collectExpiration(config, expirations);
    const hasCredential = Object.keys(config).some(isCredentialKey);
    hasStorageCredential ||= hasCredential;
    if (requested && hasCredential) {
      entries.push({
        provider: providerFor(prefix, config),
        prefix,
        config,
      });
    }
  }

  const keys = [...configKeys].sort();
  const hasInlineCredential = keys.some(isCredentialKey);
  const metadata: VendedCredentialMetadata = {
    requested,
    provided: hasStorageCredential || hasInlineCredential,
    providers: [...providers].sort(),
    expiresAtMs: expirations.length > 0 ? Math.min(...expirations) : null,
    configKeys: keys,
    storageCredentialCount: rawCredentials.length,
  };
  return {
    metadata,
    lease:
      requested && entries.length > 0
        ? new VendedCredentialLease(entries, metadata.expiresAtMs)
        : null,
  };
}

function detectProvider(
  prefix: string,
  config: Record<string, string>,
  providers: Set<string>,
): void {
  const keys = Object.keys(config);
  let detected = false;
  if (/^s3:\/\//i.test(prefix) || keys.some((key) => key.startsWith('s3.'))) {
    providers.add('s3');
    detected = true;
  }
  if (/^(gs|gcs):\/\//i.test(prefix) || keys.some((key) => /^(gcs|gs)\./.test(key))) {
    providers.add('gcs');
    detected = true;
  }
  if (/^(abfs|abfss|azure):\/\//i.test(prefix) || keys.some((key) => /^(adls|azure)\./.test(key))) {
    providers.add('azure');
    detected = true;
  }
  if (prefix && !detected) providers.add('unknown');
}

function providerFor(prefix: string, config: Record<string, string>): VendedCredentialProvider {
  const providers = new Set<string>();
  detectProvider(prefix, config, providers);
  const provider = [...providers];
  return provider.length === 1 && ['s3', 'gcs', 'azure'].includes(provider[0] ?? '')
    ? (provider[0] as VendedCredentialProvider)
    : 'unknown';
}

function validateCredentialEntry(entry: VendedStorageCredential): void {
  let valid = false;
  if (entry.provider === 's3') {
    valid = ['s3.access-key-id', 's3.secret-access-key', 's3.session-token'].every((key) =>
      Boolean(entry.config[key]?.trim()),
    );
  } else if (entry.provider === 'gcs') {
    valid = Boolean(entry.config['gcs.oauth2.token']?.trim());
  } else if (entry.provider === 'azure') {
    valid = Object.entries(entry.config).some(
      ([key, value]) => /^adls\.sas-token(?:\.|$)/.test(key) && Boolean(value.trim()),
    );
  }
  if (!valid) {
    throw new IcebergCatalogError(
      `Catalog returned an incomplete or unsupported ${entry.provider} credential shape.`,
      200,
      entry.provider === 'unknown' ? 'unsupported_credential_provider' : 'incomplete_credentials',
    );
  }
}

function collectExpiration(config: Record<string, string>, expirations: number[]): void {
  for (const [key, value] of Object.entries(config)) {
    if (!isCredentialExpirationKey(key)) continue;
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      throw new IcebergCatalogError(
        `Catalog ${key} must be a positive integer.`,
        200,
        'invalid_catalog',
      );
    }
    expirations.push(parsed);
  }
}

function isCredentialExpirationKey(key: string): boolean {
  return (
    key === 'expires-at-ms' ||
    key === 's3.session-token-expires-at-ms' ||
    key === 'gcs.oauth2.token-expires-at' ||
    key === 'adls.sas-token-expires-at-ms' ||
    key.startsWith('adls.sas-token-expires-at-ms.')
  );
}

function isCredentialKey(key: string): boolean {
  if (/refresh-credentials-endpoint|expires-at/i.test(key)) return false;
  return /(^token$|secret|access-key|session-token|credential|oauth|sas-token)/i.test(key);
}

function credentialNow(value: number | undefined): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : Date.now();
}

function credentialMinValidity(value: number | undefined): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : DEFAULT_MIN_CREDENTIAL_VALIDITY_MS;
}

async function clearCredentialTarget(target: VendedCredentialTarget): Promise<void> {
  try {
    await target.clear();
  } catch {
    throw new IcebergCatalogError(
      'Vended credential target could not be cleared.',
      0,
      'credential_clear_failed',
    );
  }
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function positiveLimit(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}
