// Bearer-token validation helper.
//
// Pretty much any HTTP `Authorization: Bearer <token>` we send (Iceberg
// catalogs, Iceberg table-storage hosts via DuckDB httpfs, Compute
// Bridge endpoints) is built by string-interpolating a user-supplied
// token. If the token contains a `\r\n` (CRLF), classic HTTP header
// injection / response-splitting becomes possible against any layer
// that doesn't validate header bytes.
//
// Forward-pass M1 (2026-06-02): tighten at every entry point. The
// browser's fetch DOES reject malformed header values (throws on
// non-byte chars; `\r\n` triggers TypeError), but DuckDB-wasm's
// httpfs interpolates the literal string into the outgoing request
// without checking. Validate ourselves so the rejection is loud and
// uniform across paths.
//
// Token charset comes from RFC 7235 §2.1 (Bearer token68):
//   token68 = 1*( ALPHA / DIGIT / "-" / "." / "_" / "~" / "+" / "/" ) *"="
//
// Real-world OAuth bearer tokens (JWTs, opaque keys) fit this charset.
// We intentionally don't broaden beyond it — if a user pastes
// something with quotes / spaces / CR / LF, that's a paste error or a
// shape we don't intend to support, and rejecting is the right move.

const BEARER_TOKEN_CHARSET = /^[A-Za-z0-9._~+/=-]+$/;

export class InvalidBearerTokenError extends Error {
  constructor(public readonly reason: string) {
    super(`Invalid bearer token: ${reason}`);
    this.name = 'InvalidBearerTokenError';
  }
}

/**
 * Returns `true` if the token is acceptable to send in an HTTP
 * `Authorization: Bearer …` header. Empty string → false. Returns
 * `false` instead of throwing so UI code can use it for live
 * input validation.
 */
export function isSafeBearerToken(token: string): boolean {
  if (!token) return false;
  return BEARER_TOKEN_CHARSET.test(token);
}

/**
 * Throws `InvalidBearerTokenError` if the token contains anything
 * outside the RFC 7235 token68 charset. Use at every use site that
 * builds an `Authorization` header — engine.ts, bridge-client.ts,
 * and the mount modals' onSubmit hooks.
 *
 * Empty token is permitted (the no-auth path); callers that require a
 * non-empty token should check separately.
 */
export function assertSafeBearerToken(token: string): void {
  if (!token) return;
  if (!BEARER_TOKEN_CHARSET.test(token)) {
    // Identify the specific failure to make the error actionable.
    if (/[\r\n]/.test(token)) {
      throw new InvalidBearerTokenError(
        'token contains CR or LF; bearer tokens must be a single line of printable ASCII',
      );
    }
    if (/\s/.test(token)) {
      throw new InvalidBearerTokenError(
        'token contains whitespace; trim leading/trailing spaces and try again',
      );
    }
    throw new InvalidBearerTokenError(
      'token contains characters outside RFC 7235 token68 charset (A-Z, a-z, 0-9, "-", ".", "_", "~", "+", "/", "=")',
    );
  }
}
