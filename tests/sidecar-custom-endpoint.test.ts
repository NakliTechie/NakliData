import { describe, expect, it, vi } from 'vitest';
import {
  callCustomOpenAI,
  resolveChatCompletionsUrl,
} from '../src/core/sidecar/providers/custom-openai.ts';
import { SidecarError } from '../src/core/sidecar/types.ts';

describe('resolveChatCompletionsUrl (Wave 2 W2.3)', () => {
  it('appends /v1/chat/completions to a bare base URL', () => {
    expect(resolveChatCompletionsUrl('https://llama.example.com')).toBe(
      'https://llama.example.com/v1/chat/completions',
    );
    expect(resolveChatCompletionsUrl('https://llama.example.com/')).toBe(
      'https://llama.example.com/v1/chat/completions',
    );
  });

  it('appends /chat/completions when the input ends with /v1', () => {
    expect(resolveChatCompletionsUrl('https://llama.example.com/v1')).toBe(
      'https://llama.example.com/v1/chat/completions',
    );
    expect(resolveChatCompletionsUrl('https://llama.example.com/v2')).toBe(
      'https://llama.example.com/v2/chat/completions',
    );
  });

  it('leaves a fully-qualified /v1/chat/completions URL unchanged', () => {
    expect(resolveChatCompletionsUrl('https://x.example.com/v1/chat/completions')).toBe(
      'https://x.example.com/v1/chat/completions',
    );
  });

  it('strips trailing slashes before resolving', () => {
    expect(resolveChatCompletionsUrl('https://x.example.com///')).toBe(
      'https://x.example.com/v1/chat/completions',
    );
  });
});

describe('callCustomOpenAI (Wave 2 W2.3)', () => {
  function makeFetchSpy(body: unknown) {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchSpy = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    return { calls, fetchSpy };
  }

  it('POSTs Chat Completions and returns the assistant text', async () => {
    const originalFetch = globalThis.fetch;
    const { calls, fetchSpy } = makeFetchSpy({
      choices: [{ message: { content: 'hello world' } }],
    });
    globalThis.fetch = fetchSpy as never;
    try {
      const text = await callCustomOpenAI({
        endpointUrl: 'https://llm.example.com',
        apiKey: 'sk-test',
        model: 'mixtral-8x7b',
        system: 'You are helpful.',
        user: 'Hi',
      });
      expect(text).toBe('hello world');
      expect(calls[0]?.url).toBe('https://llm.example.com/v1/chat/completions');
      const init = calls[0]?.init;
      expect(init?.method).toBe('POST');
      const headers = new Headers(init?.headers);
      expect(headers.get('authorization')).toBe('Bearer sk-test');
      expect(headers.get('content-type')).toBe('application/json');
      const sent = JSON.parse(String(init?.body)) as {
        model: string;
        messages: Array<{ role: string }>;
      };
      expect(sent.model).toBe('mixtral-8x7b');
      expect(sent.messages[0]?.role).toBe('system');
      expect(sent.messages[1]?.role).toBe('user');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('W6: omits the Authorization header when the key is empty (unauthenticated endpoint)', async () => {
    const originalFetch = globalThis.fetch;
    const { calls, fetchSpy } = makeFetchSpy({ choices: [{ message: { content: 'k' } }] });
    globalThis.fetch = fetchSpy as never;
    try {
      await callCustomOpenAI({
        endpointUrl: 'https://llm.example.com',
        apiKey: '',
        model: 'llama3',
        system: 's',
        user: 'u',
      });
      const headers = new Headers(calls[0]?.init?.headers);
      expect(headers.has('authorization')).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('rejects empty endpoint URL as no-provider', async () => {
    await expect(
      callCustomOpenAI({
        endpointUrl: '   ',
        apiKey: 'k',
        model: 'm',
        system: 's',
        user: 'u',
      }),
    ).rejects.toMatchObject({ kind: 'no-provider' });
  });

  it('rejects empty model as no-provider', async () => {
    await expect(
      callCustomOpenAI({
        endpointUrl: 'https://x.example.com',
        apiKey: 'k',
        model: '',
        system: 's',
        user: 'u',
      }),
    ).rejects.toMatchObject({ kind: 'no-provider' });
  });

  it('treats HTTP 429 as rate-limit', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(
      async () => new Response('Too Many Requests', { status: 429 }),
    ) as never;
    try {
      await expect(
        callCustomOpenAI({
          endpointUrl: 'https://x.example.com',
          apiKey: 'k',
          model: 'm',
          system: 's',
          user: 'u',
        }),
      ).rejects.toMatchObject({ kind: 'rate-limit' });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('wraps other non-2xx responses as http errors', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(
      async () => new Response('Internal Server Error', { status: 500 }),
    ) as never;
    try {
      const err = await callCustomOpenAI({
        endpointUrl: 'https://x.example.com',
        apiKey: 'k',
        model: 'm',
        system: 's',
        user: 'u',
      }).catch((e) => e);
      expect(err).toBeInstanceOf(SidecarError);
      expect((err as SidecarError).kind).toBe('http');
      expect((err as SidecarError).message).toContain('500');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('surfaces empty-content responses as parse errors', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: '' } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ) as never;
    try {
      await expect(
        callCustomOpenAI({
          endpointUrl: 'https://x.example.com',
          apiKey: 'k',
          model: 'm',
          system: 's',
          user: 'u',
        }),
      ).rejects.toMatchObject({ kind: 'parse' });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
