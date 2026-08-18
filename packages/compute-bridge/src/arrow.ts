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
      vectors[column.name] = utf8Vector(rows, columnIndex);
    }
    return tableToIPC(new Table(vectors), 'stream');
  }
}

function utf8Vector(
  rows: readonly (readonly (string | null)[])[],
  columnIndex: number,
): Vector<Utf8> {
  const encoder = new TextEncoder();
  const valueOffsets = new Int32Array(rows.length + 1);
  let byteLength = 0;
  let nullCount = 0;
  for (let index = 0; index < rows.length; index++) {
    const value = rows[index]?.[columnIndex] ?? null;
    if (value === null) nullCount++;
    else byteLength += utf8ByteLength(value);
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
  const nullBitmap = nullCount > 0 ? new Uint8Array(Math.ceil(rows.length / 8)) : null;
  let offset = 0;
  for (let index = 0; index < rows.length; index++) {
    const value = rows[index]?.[columnIndex] ?? null;
    if (value !== null) {
      const end = valueOffsets[index + 1] ?? offset;
      const encoded = encoder.encodeInto(value, data.subarray(offset, end));
      if (encoded.read !== value.length || encoded.written !== end - offset) {
        throw new BridgeServerError(
          'Warehouse UTF-8 encoding was incomplete.',
          'invalid_result',
          502,
        );
      }
      offset = end;
      if (nullBitmap) {
        const bitmapIndex = index >> 3;
        nullBitmap[bitmapIndex] = (nullBitmap[bitmapIndex] ?? 0) | (1 << (index & 7));
      }
    }
  }

  return makeVector(
    makeData({
      type: new Utf8(),
      length: rows.length,
      nullCount,
      valueOffsets,
      data,
      ...(nullBitmap ? { nullBitmap } : {}),
    }),
  );
}

function utf8ByteLength(value: string): number {
  let length = 0;
  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x7f) {
      length++;
    } else if (codeUnit <= 0x7ff) {
      length += 2;
    } else if (
      codeUnit >= 0xd800 &&
      codeUnit <= 0xdbff &&
      index + 1 < value.length &&
      value.charCodeAt(index + 1) >= 0xdc00 &&
      value.charCodeAt(index + 1) <= 0xdfff
    ) {
      length += 4;
      index++;
    } else {
      length += 3;
    }
  }
  return length;
}
