import type { VendedCredentialTarget, VendedStorageCredential } from '../iceberg-rest-client.ts';

export interface DuckDbCredentialExecutor {
  ensureExtension(name: string): Promise<void>;
  exec(sql: string): Promise<void>;
}

export type DuckDbCredentialTargetErrorCode =
  | 'credentials_required'
  | 'unsupported_provider'
  | 'azure_wasm_unavailable'
  | 'invalid_scope'
  | 'ambiguous_scope'
  | 'incomplete_credentials'
  | 'replace_failed'
  | 'clear_failed';

export class DuckDbCredentialTargetError extends Error {
  constructor(
    message: string,
    public readonly code: DuckDbCredentialTargetErrorCode,
  ) {
    super(message);
    this.name = 'DuckDbCredentialTargetError';
  }
}

interface PreparedSecret {
  name: string;
  sql: string;
}

/**
 * DuckDB Secrets Manager target for short-lived Iceberg storage credentials.
 *
 * The executor sees credential-bearing SQL only inside this trusted boundary.
 * Every replacement is one DuckDB transaction, operations are serialized, and
 * any failed replacement is followed by target-owned cleanup. Secrets are
 * temporary (`CREATE SECRET`, never `CREATE PERSISTENT SECRET`) and scoped when
 * the catalog provides a storage prefix.
 *
 * DuckDB-WASM 1.32.0 / core v1.4.3 is browser-proven for S3 session
 * credentials and GCS OAuth2 bearer tokens. Its official WASM registry has no
 * Azure extension, so ADLS deliberately fails before executor access.
 */
export class DuckDbVendedCredentialTarget implements VendedCredentialTarget {
  readonly #executor: DuckDbCredentialExecutor;
  #activeNames: string[] = [];
  #tail: Promise<void> = Promise.resolve();

  constructor(executor: DuckDbCredentialExecutor) {
    this.#executor = executor;
  }

  replace(credentials: readonly VendedStorageCredential[]): Promise<void> {
    const snapshot = credentials.map((credential) => ({
      provider: credential.provider,
      prefix: credential.prefix,
      config: { ...credential.config },
    }));
    return this.#enqueue(() => this.#replace(snapshot));
  }

  clear(): Promise<void> {
    return this.#enqueue(() => this.#clear());
  }

  toJSON(): Record<string, unknown> {
    return {
      opaque: true,
      activeCredentialCount: this.#activeNames.length,
    };
  }

  #enqueue(operation: () => Promise<void>): Promise<void> {
    const next = this.#tail.then(operation, operation);
    this.#tail = next.catch(() => {});
    return next;
  }

  async #replace(credentials: readonly VendedStorageCredential[]): Promise<void> {
    let prepared: PreparedSecret[];
    try {
      prepared = prepareSecrets(credentials);
    } catch (error) {
      if (this.#activeNames.length > 0) {
        try {
          await this.#dropNames(this.#activeNames);
          this.#activeNames = [];
        } catch {
          await this.#rollbackQuietly();
          throw new DuckDbCredentialTargetError(
            'DuckDB rejected the new credential shape and the previous target could not be cleared.',
            'clear_failed',
          );
        }
      }
      throw error;
    }
    try {
      await this.#executor.ensureExtension('httpfs');
      const oldNames = [...this.#activeNames];
      const statements = [
        'BEGIN TRANSACTION',
        ...oldNames.map((name) => `DROP SECRET IF EXISTS ${name}`),
        ...prepared.map((secret) => secret.sql),
        'COMMIT',
      ];
      await this.#executor.exec(`${statements.join(';\n')};`);
      this.#activeNames = prepared.map((secret) => secret.name);
    } catch (error) {
      await this.#rollbackQuietly();
      const cleanupNames = [
        ...new Set([...this.#activeNames, ...prepared.map(({ name }) => name)]),
      ];
      try {
        await this.#dropNames(cleanupNames);
        this.#activeNames = [];
      } catch {
        await this.#rollbackQuietly();
        throw new DuckDbCredentialTargetError(
          'DuckDB credential replacement failed and target cleanup could not be confirmed.',
          'clear_failed',
        );
      }
      if (error instanceof DuckDbCredentialTargetError) throw error;
      throw new DuckDbCredentialTargetError(
        'DuckDB credential replacement failed; target-owned secrets were cleared.',
        'replace_failed',
      );
    }
  }

  async #clear(): Promise<void> {
    const names = [...this.#activeNames];
    try {
      await this.#dropNames(names);
      this.#activeNames = [];
    } catch {
      await this.#rollbackQuietly();
      throw new DuckDbCredentialTargetError(
        'DuckDB credential target could not be cleared.',
        'clear_failed',
      );
    }
  }

  async #dropNames(names: readonly string[]): Promise<void> {
    if (names.length === 0) return;
    const statements = [
      'BEGIN TRANSACTION',
      ...names.map((name) => `DROP SECRET IF EXISTS ${name}`),
      'COMMIT',
    ];
    await this.#executor.exec(`${statements.join(';\n')};`);
  }

  async #rollbackQuietly(): Promise<void> {
    try {
      await this.#executor.exec('ROLLBACK');
    } catch {
      // The failed statement may already have rolled back.
    }
  }
}

function prepareSecrets(credentials: readonly VendedStorageCredential[]): PreparedSecret[] {
  if (credentials.length === 0) {
    throw new DuckDbCredentialTargetError(
      'At least one vended credential is required.',
      'credentials_required',
    );
  }
  const scopesByProvider = new Map<VendedStorageCredential['provider'], Array<string | null>>();
  return credentials.map((credential, index) => {
    if (credential.provider === 'azure') {
      throw new DuckDbCredentialTargetError(
        'The reviewed DuckDB-WASM candidate has no Azure extension artifact.',
        'azure_wasm_unavailable',
      );
    }
    if (credential.provider !== 's3' && credential.provider !== 'gcs') {
      throw new DuckDbCredentialTargetError(
        'The vended credential provider is not supported by the DuckDB target.',
        'unsupported_provider',
      );
    }
    const scope = validateScope(credential);
    const providerScopes = scopesByProvider.get(credential.provider) ?? [];
    if (
      providerScopes.some(
        (existingScope) =>
          scope === null || existingScope === null || credentialScopesOverlap(existingScope, scope),
      )
    ) {
      throw new DuckDbCredentialTargetError(
        'Overlapping credential scopes for one provider are ambiguous.',
        'ambiguous_scope',
      );
    }
    providerScopes.push(scope);
    scopesByProvider.set(credential.provider, providerScopes);
    if (credential.provider === 's3') return prepareS3(credential, index, scope);
    return prepareGcs(credential, index, scope);
  });
}

function prepareS3(
  credential: VendedStorageCredential,
  index: number,
  scope: string | null,
): PreparedSecret {
  const keyId = required(credential.config, 's3.access-key-id');
  const secret = required(credential.config, 's3.secret-access-key');
  const sessionToken = required(credential.config, 's3.session-token');
  const region = optional(credential.config, ['s3.region', 'client.region']);
  const name = `__naklidata_vended_s3_${index}`;
  return {
    name,
    sql: createSecretSql(name, [
      'TYPE s3',
      'PROVIDER config',
      `KEY_ID ${literal(keyId)}`,
      `SECRET ${literal(secret)}`,
      `SESSION_TOKEN ${literal(sessionToken)}`,
      ...(region ? [`REGION ${literal(region)}`] : []),
      ...(scope ? [`SCOPE ${literal(scope)}`] : []),
    ]),
  };
}

function prepareGcs(
  credential: VendedStorageCredential,
  index: number,
  scope: string | null,
): PreparedSecret {
  const token = required(credential.config, 'gcs.oauth2.token');
  const name = `__naklidata_vended_gcs_${index}`;
  return {
    name,
    sql: createSecretSql(name, [
      'TYPE gcs',
      'PROVIDER config',
      `BEARER_TOKEN ${literal(token)}`,
      ...(scope ? [`SCOPE ${literal(scope)}`] : []),
    ]),
  };
}

function createSecretSql(name: string, fields: readonly string[]): string {
  return `CREATE SECRET ${name} (\n  ${fields.join(',\n  ')}\n)`;
}

function validateScope(credential: VendedStorageCredential): string | null {
  if (credential.prefix === null) return null;
  const scope = credential.prefix.trim();
  const allowedPattern =
    credential.provider === 's3'
      ? /^s3:\/\/[^/\s]+(?:\/.*)?$/i
      : credential.provider === 'gcs'
        ? /^(?:gs|gcs):\/\/[^/\s]+(?:\/.*)?$/i
        : null;
  if (
    !allowedPattern?.test(scope) ||
    scope.length > 8_192 ||
    containsControlCharacter(scope) ||
    scope.includes('\\')
  ) {
    throw new DuckDbCredentialTargetError(
      'The vended credential scope is invalid for its provider.',
      'invalid_scope',
    );
  }
  return scope;
}

function credentialScopesOverlap(left: string, right: string): boolean {
  const canonicalLeft = canonicalCredentialScope(left);
  const canonicalRight = canonicalCredentialScope(right);
  return canonicalLeft.startsWith(canonicalRight) || canonicalRight.startsWith(canonicalLeft);
}

function canonicalCredentialScope(scope: string): string {
  const separator = scope.indexOf('://');
  const pathStart = scope.indexOf('/', separator + 3);
  const scheme = scope.slice(0, separator).toLowerCase().replace('gcs', 'gs');
  const authorityEnd = pathStart === -1 ? scope.length : pathStart;
  const authority = scope.slice(separator + 3, authorityEnd).toLowerCase();
  return `${scheme}://${authority}${scope.slice(authorityEnd)}`;
}

function required(config: Readonly<Record<string, string>>, key: string): string {
  const value = config[key];
  if (
    value === undefined ||
    value.trim().length === 0 ||
    value.length > 65_536 ||
    containsControlCharacter(value)
  ) {
    throw new DuckDbCredentialTargetError(
      'The vended credential is incomplete.',
      'incomplete_credentials',
    );
  }
  return value;
}

function optional(
  config: Readonly<Record<string, string>>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = config[key];
    if (value?.trim()) {
      if (
        value.length > 1_024 ||
        containsControlCharacter(value) ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
      ) {
        throw new DuckDbCredentialTargetError(
          'The vended credential is incomplete.',
          'incomplete_credentials',
        );
      }
      return value;
    }
  }
  return null;
}

function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}
