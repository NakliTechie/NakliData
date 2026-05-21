import { beforeEach, describe, expect, it } from 'vitest';
import { getDemoMode, maskLabel, resetDemoMaskState, setDemoMode } from '../src/core/demo-mode.ts';

describe('demo-mode mask helper', () => {
  beforeEach(() => {
    setDemoMode(false);
    resetDemoMaskState();
  });

  it('returns labels unchanged when demo mode is off', () => {
    expect(maskLabel('column', 'vendor_id')).toBe('vendor_id');
    expect(maskLabel('source', 'SMB Finance')).toBe('SMB Finance');
  });

  it('returns prefixed tokens when demo mode is on', () => {
    setDemoMode(true);
    expect(maskLabel('column', 'vendor_id')).toBe('col_1');
    expect(maskLabel('column', 'amount')).toBe('col_2');
    expect(maskLabel('table', 'invoices')).toBe('tbl_1');
    expect(maskLabel('source', 'SMB Finance')).toBe('src_1');
    expect(maskLabel('origin', 'examples/finance/vendors.csv')).toBe('path_1');
  });

  it('returns the same token for the same input within a session', () => {
    setDemoMode(true);
    const a = maskLabel('column', 'vendor_id');
    const b = maskLabel('column', 'vendor_id');
    expect(a).toBe(b);
    expect(a).toBe('col_1');
  });

  it('keeps separate counters per kind', () => {
    setDemoMode(true);
    maskLabel('column', 'a');
    maskLabel('column', 'b');
    maskLabel('table', 'a');
    expect(maskLabel('column', 'c')).toBe('col_3');
    expect(maskLabel('table', 'b')).toBe('tbl_2');
  });

  it('passes through empty / null / undefined', () => {
    setDemoMode(true);
    expect(maskLabel('column', '')).toBe('');
    expect(maskLabel('column', null)).toBe('');
    expect(maskLabel('column', undefined)).toBe('');
  });

  it('resetDemoMaskState restarts the counters', () => {
    setDemoMode(true);
    maskLabel('column', 'a');
    maskLabel('column', 'b');
    resetDemoMaskState();
    expect(maskLabel('column', 'a')).toBe('col_1');
  });

  it('getDemoMode reflects setDemoMode', () => {
    setDemoMode(true);
    expect(getDemoMode()).toBe(true);
    setDemoMode(false);
    expect(getDemoMode()).toBe(false);
  });

  it('flipping back off after a session keeps the underlying labels intact for callers', () => {
    setDemoMode(true);
    expect(maskLabel('column', 'vendor_id')).toBe('col_1');
    setDemoMode(false);
    expect(maskLabel('column', 'vendor_id')).toBe('vendor_id');
  });
});
