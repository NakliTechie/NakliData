// Compute Bridge HTTP client — W3.4a.
//
// The browser side of the Compute Bridge wire protocol (see
// `plan/compute-bridge-protocol.md`). The bridge binary is a separate
// OSS repo; this client speaks just the four endpoints NakliData
// actually needs:
//
//   GET  /v1/health          — discovery + capability handshake
//   GET  /v1/tables          — catalog (what's queryable)
//   POST /v1/query           — SQL → Arrow IPC stream
//
// Browser↔bridge uses HTTP + Arrow IPC, NOT Arrow Flight — browsers
// can't speak native gRPC; gRPC-web needs a proxy and doesn't stream
// server→client cleanly. Flight stays the canonical API for
// non-browser clients (BI tools, CLI). Results from /v1/query land in
// DuckDB-wasm via the existing `insertArrowFromIPCStream` path
// (Engine.registerArrowBuffer).

import { assertSafeBearerToken } from '../bearer-token.ts';

export interface BridgeClientOptions {
  /** Bridge base URL — e.g. `https://nakli-compute.your-vpc.internal:8088`. */
  bridgeUrl: string;
  /** Optional Bearer token. Omitted entirely from requests when null. */
  bearerToken: string | null;
  /** Override fetch — handy for tests. */
  fetchImpl?: typeof fetch;
}

export interface BridgeHealth {
  name: string;
  version: string;
  /** "bearer" | "oauth2" | "none". OAuth2 lands in v1.4. */
  auth: string;
  /** false → authorization layer active (v1.4). */
  singleTenant: boolean;
  capabilities: string[];
}

export interface BridgeColumn {
  name: string;
  type: string;
}

export interface BridgeTable {
  name: string;
  /** Informational — which configured source the bridge pulled this from. */
  source?: string;
  schema: BridgeColumn[];
}

export class BridgeError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code = 'bridge_error') {
    super(message);
    this.name = 'BridgeError';
    this.status = status;
    this.code = code;
  }
}

export class BridgeClient {
  private readonly bridgeUrl: string;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: BridgeClientOptions) {
    if (!opts.bridgeUrl.trim()) throw new Error('Bridge URL is required.');
    // Trim trailing slashes — every path we build starts with /v1/...
    this.bridgeUrl = opts.bridgeUrl.trim().replace(/\/+$/, '');
    this.headers = { Accept: 'application/json' };
    if (opts.bearerToken) {
      // Reject malformed tokens before they reach `fetch` headers
      // (browser fetch throws on CR/LF anyway, but this gives a clear
      // error message at the API boundary). Forward-pass M1.
      assertSafeBearerToken(opts.bearerToken);
      this.headers.Authorization = `Bearer ${opts.bearerToken}`;
    }
    this.fetchImpl = opts.fetchImpl ?? fetch.bind(globalThis);
  }

  /**
   * The reachability probe + handshake. The mount flow calls this
   * first; if it fails (network, 401, non-2xx), the source enters a
   * graceful "bridge unreachable / reconnect" state and the rest of
   * the NakliData session keeps working.
   */
  async health(): Promise<BridgeHealth> {
    const data = (await this.getJson('/v1/health')) as {
      name?: unknown;
      version?: unknown;
      auth?: unknown;
      // Spec uses snake_case; tolerate camelCase too.
      single_tenant?: unknown;
      singleTenant?: unknown;
      capabilities?: unknown;
    };
    return {
      name: typeof data.name === 'string' ? data.name : 'compute-bridge',
      version: typeof data.version === 'string' ? data.version : '0.0.0',
      auth: typeof data.auth === 'string' ? data.auth : 'bearer',
      singleTenant:
        typeof data.single_tenant === 'boolean'
          ? data.single_tenant
          : typeof data.singleTenant === 'boolean'
            ? data.singleTenant
            : true,
      capabilities: Array.isArray(data.capabilities)
        ? data.capabilities.filter((x): x is string => typeof x === 'string')
        : [],
    };
  }

  /** List tables the bridge exposes. */
  async listTables(): Promise<BridgeTable[]> {
    const data = (await this.getJson('/v1/tables')) as {
      tables?: Array<{ name?: unknown; source?: unknown; schema?: unknown }>;
    };
    if (!Array.isArray(data.tables)) return [];
    return data.tables
      .map((t) => {
        if (typeof t.name !== 'string') return null;
        const schema: BridgeColumn[] = [];
        if (Array.isArray(t.schema)) {
          for (const col of t.schema) {
            if (typeof col !== 'object' || col === null) continue;
            const c = col as { name?: unknown; type?: unknown };
            if (typeof c.name === 'string' && typeof c.type === 'string') {
              schema.push({ name: c.name, type: c.type });
            }
          }
        }
        const out: BridgeTable = { name: t.name, schema };
        if (typeof t.source === 'string') out.source = t.source;
        return out;
      })
      .filter((t): t is BridgeTable => t !== null);
  }

  /**
   * POST a SQL query to the bridge; receive an Arrow IPC stream.
   * Returns the raw bytes so the caller can feed them straight to
   * `Engine.registerArrowBuffer` (which uses DuckDB-wasm's
   * `insertArrowFromIPCStream`). The heavy scan/join runs in-VPC
   * inside the bridge; only the (small) result set crosses to the
   * browser as Arrow.
   */
  async query(sql: string): Promise<ArrayBuffer> {
    const url = `${this.bridgeUrl}/v1/query`;
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: { ...this.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql }),
    });
    if (!res.ok) {
      throw await this.toBridgeError(res);
    }
    return res.arrayBuffer();
  }

  private async getJson(path: string): Promise<unknown> {
    const res = await this.fetchImpl(`${this.bridgeUrl}${path}`, {
      method: 'GET',
      headers: this.headers,
    });
    if (!res.ok) {
      throw await this.toBridgeError(res);
    }
    return (await res.json()) as unknown;
  }

  /**
   * Build a BridgeError from a non-2xx response. Tries to read the
   * JSON `{ error: { code, message } }` shape the protocol specifies;
   * falls back to the HTTP status text on a malformed body.
   */
  private async toBridgeError(res: Response): Promise<BridgeError> {
    let code = 'bridge_error';
    let message = `Bridge ${res.status}: ${res.statusText || 'request failed'}`;
    try {
      const text = await res.text();
      if (text) {
        try {
          const body = JSON.parse(text) as { error?: { code?: unknown; message?: unknown } };
          const err = body.error;
          if (err && typeof err === 'object') {
            if (typeof err.code === 'string') code = err.code;
            if (typeof err.message === 'string' && err.message.trim()) {
              message = `Bridge ${res.status}: ${err.message}`;
            }
          }
        } catch {
          // Body wasn't JSON — keep the default message.
          message = `Bridge ${res.status}: ${text.slice(0, 240) || res.statusText}`;
        }
      }
    } catch {
      // Reading the body threw — keep the default message.
    }
    return new BridgeError(message, res.status, code);
  }
}
