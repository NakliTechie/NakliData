// Regression tests for `arrowToStreamIPC` (DECISIONS BX/F2).
//
// The mount bug: `.arrow`/`.feather` files are Arrow IPC *file* format
// (`ARROW1` magic + footer), but the engine fed them to DuckDB-wasm's
// `insertArrowFromIPCStream`, which expects IPC *stream* framing — so a
// file buffer silently produced no table. `arrowToStreamIPC` re-frames
// file→stream (apache-arrow reads both) so the stream inserter ingests it.
//
// We build the IPC bytes in-memory with apache-arrow's own writer (no
// fixture file). The chunk imports apache-arrow, which is node-resolvable
// under vitest, so this runs without a browser.

import { tableFromArrays, tableFromIPC, tableToIPC } from 'apache-arrow';
import { describe, expect, it } from 'vitest';
import { arrowToStreamIPC } from '../src/lazy/arrow-reader.ts';

function sampleTable() {
  return tableFromArrays({
    id: Int32Array.from([1, 2, 3]),
    score: Float64Array.from([1.5, 2.5, 3.5]),
  });
}

describe('arrowToStreamIPC', () => {
  it('re-frames an IPC *file* (ARROW1) buffer into stream bytes that round-trip', () => {
    const fileBytes = tableToIPC(sampleTable(), 'file');
    // Sanity: the input really is file format (magic bytes).
    expect(new TextDecoder().decode(fileBytes.slice(0, 6))).toBe('ARROW1');

    const streamBytes = arrowToStreamIPC(fileBytes);
    // Output must NOT carry the file magic — it's stream framing now.
    expect(new TextDecoder().decode(streamBytes.slice(0, 6))).not.toBe('ARROW1');

    const roundTrip = tableFromIPC(streamBytes);
    expect(roundTrip.numRows).toBe(3);
    expect(roundTrip.numCols).toBe(2);
    expect(roundTrip.schema.fields.map((f) => f.name)).toEqual(['id', 'score']);
  });

  it('accepts an IPC *stream* buffer too (idempotent framing)', () => {
    const streamIn = tableToIPC(sampleTable(), 'stream');
    const streamOut = arrowToStreamIPC(streamIn);
    expect(tableFromIPC(streamOut).numRows).toBe(3);
  });

  it('throws a clear error on a non-Arrow buffer', () => {
    const garbage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(() => arrowToStreamIPC(garbage)).toThrow(/Could not read Arrow IPC data/);
  });
});
