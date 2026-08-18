import {
  Table,
  Utf8,
  type Vector,
  makeData,
  makeVector,
  tableFromIPC,
  tableToIPC,
} from 'apache-arrow';
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
      vectors[column.name] = utf8Vector(rows.map((row) => row[columnIndex] ?? null));
    }
    return tableToIPC(new Table(vectors), 'stream');
  }
}

function utf8Vector(values: readonly (string | null)[]): Vector<Utf8> {
  const encoder = new TextEncoder();
  const encoded = values.map((value) => (value === null ? null : encoder.encode(value)));
  const valueOffsets = new Int32Array(values.length + 1);
  let byteLength = 0;
  let nullCount = 0;
  for (let index = 0; index < encoded.length; index++) {
    const bytes = encoded[index] ?? null;
    if (bytes === null) nullCount++;
    else byteLength += bytes.byteLength;
    if (byteLength > 0x7fffffff) {
      throw new BridgeServerError(
        'Warehouse UTF-8 column exceeds Arrow limits.',
        'result_limit',
        502,
      );
    }
    valueOffsets[index + 1] = byteLength;
  }

  const data = new Uint8Array(byteLength);
  const nullBitmap = nullCount > 0 ? new Uint8Array(Math.ceil(values.length / 8)) : null;
  let offset = 0;
  for (let index = 0; index < encoded.length; index++) {
    const bytes = encoded[index] ?? null;
    if (bytes !== null) {
      data.set(bytes, offset);
      offset += bytes.byteLength;
      if (nullBitmap) {
        const bitmapIndex = index >> 3;
        nullBitmap[bitmapIndex] = (nullBitmap[bitmapIndex] ?? 0) | (1 << (index & 7));
      }
    }
  }

  return makeVector(
    makeData({
      type: new Utf8(),
      length: values.length,
      nullCount,
      valueOffsets,
      data,
      ...(nullBitmap ? { nullBitmap } : {}),
    }),
  );
}
