// W3.2 slice B chunk 2 — pure-helper coverage for the Transformers.js
// lazy chunk.
//
// Most of the chunk (pipeline construction, generation, model fetch)
// requires a real browser + multi-GB model download — not testable in
// vitest. Per scoping doc Decision 5, those paths get manual probes
// at chunk 5 time.
//
// What IS testable here: the HF URL parser (pure) and the
// cache-adapter wiring against the chunk-1 cache module (via the same
// stubbed-navigator approach the chunk-1 tests use). Those carry the
// risk of regressing under future Transformers.js version bumps.

import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCAL_MODEL_ID, parseHfUrl } from '../src/lazy/transformers.ts';

describe('parseHfUrl', () => {
  it('parses the canonical HF resolve URL shape', () => {
    expect(
      parseHfUrl(
        'https://huggingface.co/onnx-community/Qwen2.5-1.5B-Instruct/resolve/main/onnx/model_q4.onnx',
      ),
    ).toEqual({
      modelId: 'onnx-community/Qwen2.5-1.5B-Instruct',
      relPath: 'onnx/model_q4.onnx',
    });
  });

  it('parses single-org model ids', () => {
    expect(
      parseHfUrl('https://huggingface.co/Xenova/phi-3-mini-4k-instruct/resolve/main/config.json'),
    ).toEqual({
      modelId: 'Xenova/phi-3-mini-4k-instruct',
      relPath: 'config.json',
    });
  });

  it('handles deeper paths', () => {
    expect(
      parseHfUrl('https://huggingface.co/onnx-community/foo/resolve/main/onnx/decoder/model.onnx'),
    ).toEqual({
      modelId: 'onnx-community/foo',
      relPath: 'onnx/decoder/model.onnx',
    });
  });

  it('handles non-main revisions', () => {
    expect(parseHfUrl('https://huggingface.co/org/model/resolve/a1b2c3/onnx/model.onnx')).toEqual({
      modelId: 'org/model',
      relPath: 'onnx/model.onnx',
    });
  });

  it('returns null for non-HF URLs', () => {
    expect(parseHfUrl('https://example.com/foo')).toBeNull();
    expect(parseHfUrl('https://cdn.jsdelivr.net/path')).toBeNull();
  });

  it('returns null for HF URLs without /resolve/', () => {
    expect(parseHfUrl('https://huggingface.co/org/model')).toBeNull();
    expect(parseHfUrl('https://huggingface.co/org/model/tree/main')).toBeNull();
  });

  it('returns null for malformed inputs', () => {
    expect(parseHfUrl('not-a-url')).toBeNull();
    expect(parseHfUrl('')).toBeNull();
  });
});

describe('DEFAULT_LOCAL_MODEL_ID', () => {
  it('points at the scoping-doc-chosen default', () => {
    // Locked in per DECISIONS J / scoping Decision 1.
    expect(DEFAULT_LOCAL_MODEL_ID).toBe('onnx-community/Qwen2.5-1.5B-Instruct');
  });
});
