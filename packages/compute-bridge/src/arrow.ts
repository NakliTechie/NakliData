import { Table, Utf8, type Vector, tableFromIPC, tableToIPC, vectorFromArray } from 'apache-arrow';
import { BridgeServerError } from './backend.ts';

export interface ArrowChunk {
  index: number;
  rowOffset: number;
  rowCount: number;
  bytes: Uint8Array;
}

export interface JsonV2Column {
  name: string;
  type: string;
  nullable: boolean | null;
  precision: number | null;
  scale: number | null;
}

export class ApacheArrowChunkAssembler {
  async assemble(chunks: readonly ArrowChunk[]): Promise<Uint8Array> {
    if (chunks.length === 0) {
      throw new BridgeServerError('Warehouse returned no Arrow chunks.', 'invalid_result', 502);
    }
    const tables = chunks.map((chunk) => tableFromIPC(chunk.bytes));
    const first = tables[0];
    if (!first) {
      throw new BridgeServerError('Warehouse returned no Arrow table.', 'invalid_result', 502);
    }
    const combined = first.concat(...tables.slice(1));
    return tableToIPC(combined, 'stream');
  }
}

export class ApacheArrowJsonV2Encoder {
  async encode(
    columns: readonly JsonV2Column[],
    rows: readonly (readonly (string | null)[])[],
  ): Promise<Uint8Array> {
    const vectors: Record<string, Vector<Utf8>> = {};
    for (let columnIndex = 0; columnIndex < columns.length; columnIndex++) {
      const column = columns[columnIndex];
      if (!column || Object.hasOwn(vectors, column.name)) {
        throw new BridgeServerError(
          'Warehouse returned duplicate or invalid column metadata.',
          'invalid_result',
          502,
        );
      }
      vectors[column.name] = vectorFromArray(
        rows.map((row) => row[columnIndex] ?? null),
        new Utf8(),
      );
    }
    return tableToIPC(new Table(vectors), 'stream');
  }
}
