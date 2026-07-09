// Scrub BYOK key-shaped tokens from text before it surfaces in
// user-visible errors or logs.
//
// Threat model: a misconfigured proxy / debug endpoint can echo the
// Authorization header (or the `x-api-key` body) on 4xx responses.
// Without scrubbing, `text.slice(0, 240)` of the response body lands
// in the rendered sidecar-error UI, exposing the user's BYOK key to
// anyone shoulder-surfing the tab or to any later XSS that reads the
// DOM. (Forward-pass M4, 2026-06-02.)
//
// Patterns covered:
//   - `Bearer <token>`           — OpenAI, custom-endpoint Authorization
//   - `sk-…`                     — OpenAI key prefix
//   - `sk-ant-…`                 — Anthropic key prefix
//   - `x-api-key: <token>` header form (Anthropic)
//
// Conservatively over-redacts; under-redacting is the risk we don't
// want. The replacement preserves the surrounding text so the user
// still sees the error message context.

const REDACTION_PATTERNS: RegExp[] = [
  // `Authorization: Bearer xxx…` and any embedded `Bearer xxx`. L31: `i` flag
  // so a proxy echoing a lowercased `authorization: bearer <token>` is redacted
  // (under-redaction is the risk this module refuses to accept).
  /Bearer\s+[A-Za-z0-9._\-+/=]+/gi,
  // Anthropic keys: `sk-ant-…`
  /sk-ant-[A-Za-z0-9_-]+/g,
  // OpenAI keys: `sk-…` (after sk-ant- already matched above)
  /sk-[A-Za-z0-9_-]{16,}/g,
  // `x-api-key: <token>` (case-insensitive header name, with or
  // without quotes around the value)
  /x-api-key\s*[:=]\s*"?[A-Za-z0-9._\-+/=]+"?/gi,
];

const REPLACEMENT = '[REDACTED]';

export function redactSecrets(s: string): string {
  let out = s;
  for (const re of REDACTION_PATTERNS) {
    out = out.replace(re, REPLACEMENT);
  }
  return out;
}
