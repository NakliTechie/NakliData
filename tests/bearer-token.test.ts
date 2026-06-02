// Forward-pass M1 (2026-06-02) — bearer-token charset validation.

import { describe, expect, it } from 'vitest';
import {
  InvalidBearerTokenError,
  assertSafeBearerToken,
  isSafeBearerToken,
} from '../src/core/bearer-token.ts';

describe('assertSafeBearerToken', () => {
  it('accepts a standard OAuth2 JWT', () => {
    expect(() =>
      assertSafeBearerToken(
        'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
      ),
    ).not.toThrow();
  });

  it('accepts an opaque token with +/= padding (base64-ish)', () => {
    expect(() => assertSafeBearerToken('abc-def_ghi.jkl~mno+pqr/stu==')).not.toThrow();
  });

  it('accepts the empty string (use-site checks emptiness separately)', () => {
    expect(() => assertSafeBearerToken('')).not.toThrow();
  });

  it('rejects CR/LF — the canonical header-injection vector', () => {
    expect(() => assertSafeBearerToken('abc\r\nX-Inject: yes')).toThrow(InvalidBearerTokenError);
    expect(() => assertSafeBearerToken('abc\rinject')).toThrow(InvalidBearerTokenError);
    expect(() => assertSafeBearerToken('abc\ninject')).toThrow(InvalidBearerTokenError);
  });

  it('rejects tokens containing whitespace', () => {
    expect(() => assertSafeBearerToken('hello world')).toThrow(InvalidBearerTokenError);
    expect(() => assertSafeBearerToken('  leading')).toThrow(InvalidBearerTokenError);
    expect(() => assertSafeBearerToken('trailing  ')).toThrow(InvalidBearerTokenError);
    expect(() => assertSafeBearerToken('tab\there')).toThrow(InvalidBearerTokenError);
  });

  it('rejects tokens with quotes / parens / non-token-charset', () => {
    expect(() => assertSafeBearerToken('abc"def')).toThrow(InvalidBearerTokenError);
    expect(() => assertSafeBearerToken("abc'def")).toThrow(InvalidBearerTokenError);
    expect(() => assertSafeBearerToken('(abc)')).toThrow(InvalidBearerTokenError);
    expect(() => assertSafeBearerToken('abc<def>')).toThrow(InvalidBearerTokenError);
  });

  it('error message identifies the failure mode', () => {
    try {
      assertSafeBearerToken('foo\r\nbar');
      throw new Error('should have thrown');
    } catch (err) {
      if (!(err instanceof InvalidBearerTokenError)) throw err;
      expect(err.reason).toContain('CR or LF');
    }
    try {
      assertSafeBearerToken('foo bar');
      throw new Error('should have thrown');
    } catch (err) {
      if (!(err instanceof InvalidBearerTokenError)) throw err;
      expect(err.reason).toContain('whitespace');
    }
  });
});

describe('isSafeBearerToken (live-validation helper)', () => {
  it('returns true for the safe cases', () => {
    expect(isSafeBearerToken('sk-ant-api03-abc123')).toBe(true);
    expect(isSafeBearerToken('sk-proj-abc.def_ghi')).toBe(true);
  });

  it('returns false for unsafe cases (no throw)', () => {
    expect(isSafeBearerToken('')).toBe(false);
    expect(isSafeBearerToken('foo bar')).toBe(false);
    expect(isSafeBearerToken('foo\r\nbar')).toBe(false);
  });
});
