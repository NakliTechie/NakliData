// Lazy chunk — normalise an Apache Arrow IPC payload into IPC *stream*
// framing so DuckDB-wasm's `insertArrowFromIPCStream` can ingest it.
//
// Why this exists (real-data test, 2026-07-04 → DECISIONS BX/F2): a
// `.arrow` / `.feather` v2 file on disk is Arrow IPC **file** format —
// it starts with the `ARROW1` magic and carries a footer. But the engine
// called `insertArrowFromIPCStream`, which expects IPC **stream** framing
// (no magic, no footer). Fed a file-format buffer, the stream reader
// found no messages and silently produced nothing → the mount "succeeded"
// but the table didn't exist. This chunk closes that gap by parsing the
// payload with apache-arrow's `tableFromIPC` (which accepts BOTH file and
// stream framing) and re-emitting it as a stream the engine ingests
// natively — only `Uint8Array`s cross the module boundary, so there's no
// cross-copy Arrow `Table` identity concern with the engine's own
// apache-arrow (both resolve to the single hoisted v17 install).
//
// apache-arrow is loaded here (a lazy chunk), not in the engine, so its
// weight never touches the inlined shell bundle — it's fetched only when
// a user actually mounts an Arrow file. Same posture as the sql.js /
// SheetJS readers.

import { tableFromIPC, tableToIPC } from 'apache-arrow';

/**
 * Read an Arrow IPC payload (file OR stream framing) and return it as
 * IPC stream bytes ready for `conn.insertArrowFromIPCStream`.
 *
 * Throws a user-actionable error when the file uses record-batch
 * compression (LZ4 / ZSTD): apache-arrow's JS reader does not implement
 * IPC decompression (a long-standing library gap), so a compressed
 * `.arrow` can't be read in-browser at all. The message tells the user
 * how to re-export uncompressed rather than leaving a cryptic throw.
 */
export function arrowToStreamIPC(bytes: Uint8Array): Uint8Array {
  let table: ReturnType<typeof tableFromIPC>;
  try {
    table = tableFromIPC(bytes);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/compression/i.test(msg)) {
      throw new Error(
        'This Arrow file uses record-batch compression (LZ4/ZSTD), which the ' +
          'in-browser Arrow reader cannot decompress. Re-export it uncompressed — ' +
          "e.g. pyarrow: feather.write_feather(table, 'out.arrow', compression='uncompressed'), " +
          'or convert it to Parquet, which is fully supported.',
      );
    }
    throw new Error(`Could not read Arrow IPC data: ${msg}`);
  }
  return tableToIPC(table, 'stream');
}
