// OpenAI provider for the sidecar.
//
// Uses the public Chat Completions API. The key travels as
// `Authorization: Bearer ...`. Browser CORS is allowed by default on
// api.openai.com — no special header needed.

import { SidecarError } from '../types.ts';

export interface OpenAICallOpts {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
  signal?: AbortSignal;
}

interface OpenAIResponse {
  choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  error?: { type: string; message: string };
}

export async function callOpenAI(opts: OpenAICallOpts): Promise<string> {
  const url = 'https://api.openai.com/v1/chat/completions';
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
      throw new SidecarError('OpenAI rate-limited the request.', 'rate-limit');
    }
    const text = await res.text();
    throw new SidecarError(`OpenAI HTTP ${res.status}: ${text.slice(0, 240)}`, 'http');
  }
  const json = (await res.json()) as OpenAIResponse;
  if (json.error) {
    throw new SidecarError(`OpenAI: ${json.error.message}`, 'http');
  }
  const text = json.choices?.[0]?.message?.content ?? '';
  if (!text) throw new SidecarError('OpenAI returned no text content.', 'parse');
  return text.trim();
}
