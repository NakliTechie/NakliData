// Anthropic Claude provider for the sidecar.
//
// Uses the public Messages API with the
// `anthropic-dangerous-direct-browser-access` header to opt into
// browser-origin calls. The key travels as `x-api-key`.

import { SidecarError } from '../types.ts';
import { redactSecrets } from './redact.ts';

export interface AnthropicCallOpts {
  apiKey: string;
  model: string;
  /** System prompt (job-shape instructions). */
  system: string;
  /** User-turn content. */
  user: string;
  maxTokens?: number;
  /** Caller's abort signal — wired through to fetch. */
  signal?: AbortSignal;
}

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string }>;
  type?: string;
  error?: { type: string; message: string };
}

export async function callAnthropic(opts: AnthropicCallOpts): Promise<string> {
  const url = 'https://api.anthropic.com/v1/messages';
  const body = {
    model: opts.model,
    max_tokens: opts.maxTokens ?? 512,
    system: opts.system,
    messages: [{ role: 'user', content: opts.user }],
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': opts.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  if (!res.ok) {
    if (res.status === 429) {
      throw new SidecarError('Anthropic rate-limited the request.', 'rate-limit');
    }
    const text = await res.text();
    // Scrub Bearer/sk-/x-api-key tokens — some debug proxies echo the
    // Authorization or x-api-key header on error. (Forward-pass M4.)
    throw new SidecarError(
      `Anthropic HTTP ${res.status}: ${redactSecrets(text.slice(0, 240))}`,
      'http',
    );
  }
  const json = (await res.json()) as AnthropicResponse;
  if (json.error) {
    throw new SidecarError(`Anthropic: ${redactSecrets(json.error.message)}`, 'http');
  }
  // Concatenate text blocks; ignore tool_use / image blocks (we don't ask for them).
  const text = (json.content ?? [])
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('');
  if (!text) throw new SidecarError('Anthropic returned no text content.', 'parse');
  return text.trim();
}
