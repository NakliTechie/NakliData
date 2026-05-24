// Custom OpenAI-compatible provider for the sidecar (Wave 2 W2.3).
//
// Intended for local llamafiles, vLLM, Ollama, LM Studio, oobabooga,
// and other locally-hosted endpoints that expose the OpenAI Chat
// Completions REST shape. The URL is supplied at call time (from
// Settings); the API key is the standard Bearer header (most local
// servers ignore it, but we still send it so the user can put a token
// in front of a reverse proxy if they want).
//
// CSP `connect-src 'self' https:` (slice 1) is what makes arbitrary
// user-configured endpoints possible. Local http:// endpoints are NOT
// supported by the CSP — users running an unencrypted local model
// server should front it with a self-signed HTTPS cert or use the
// browser's localhost exception (which doesn't apply to CSP).

import { SidecarError } from '../types.ts';

export interface CustomOpenAICallOpts {
  /** The full URL to POST chat completions to (typically `<base>/v1/chat/completions`). */
  endpointUrl: string;
  apiKey: string;
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
  signal?: AbortSignal;
}

interface ChatCompletionsResponse {
  choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  error?: { type?: string; message?: string };
}

export async function callCustomOpenAI(opts: CustomOpenAICallOpts): Promise<string> {
  if (!opts.endpointUrl.trim()) {
    throw new SidecarError(
      'Custom-endpoint URL is empty. Configure it under Settings → AI sidecar.',
      'no-provider',
    );
  }
  if (!opts.model.trim()) {
    throw new SidecarError(
      'Custom-endpoint model is empty. Configure it under Settings → AI sidecar.',
      'no-provider',
    );
  }
  const url = resolveChatCompletionsUrl(opts.endpointUrl.trim());
  const body = {
    model: opts.model,
    max_tokens: opts.maxTokens ?? 512,
    messages: [
      { role: 'system', content: opts.system },
      { role: 'user', content: opts.user },
    ],
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify(body),
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  if (!res.ok) {
    if (res.status === 429) {
      throw new SidecarError('Custom endpoint rate-limited the request.', 'rate-limit');
    }
    const text = await safeReadText(res);
    throw new SidecarError(`Custom endpoint HTTP ${res.status}: ${text.slice(0, 240)}`, 'http');
  }
  const json = (await res.json()) as ChatCompletionsResponse;
  if (json.error) {
    throw new SidecarError(`Custom endpoint: ${json.error.message ?? 'unknown error'}`, 'http');
  }
  const text = json.choices?.[0]?.message?.content ?? '';
  if (!text) throw new SidecarError('Custom endpoint returned no text content.', 'parse');
  return text.trim();
}

/**
 * Accept three input shapes for the endpoint URL:
 *  - a bare base URL like `https://llama.example.com/` → append `/v1/chat/completions`
 *  - a `/v1` base like `https://llama.example.com/v1` → append `/chat/completions`
 *  - a fully-qualified `/v1/chat/completions` URL → leave as-is
 *
 * This matches what most OpenAI-compatible servers document in their
 * READMEs and saves the user from yet another knob.
 */
export function resolveChatCompletionsUrl(base: string): string {
  const trimmed = base.replace(/\/+$/, '');
  if (/\/v\d+\/chat\/completions$/.test(trimmed)) return trimmed;
  if (/\/v\d+$/.test(trimmed)) return `${trimmed}/chat/completions`;
  return `${trimmed}/v1/chat/completions`;
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
