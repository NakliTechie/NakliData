import { tableFromArrays, tableFromIPC, tableToIPC } from 'apache-arrow';
import { describe, expect, it } from 'vitest';
import { ApacheArrowChunkAssembler, ApacheArrowJsonV2Encoder } from '../src/arrow.ts';

describe('concrete Arrow boundaries', () => {
  it('assembles ordered Databricks Arrow stream chunks', async () => {
    const first = tableToIPC(tableFromArrays({ id: [1, 2] }), 'stream');
    const second = tableToIPC(tableFromArrays({ id: [3] }), 'stream');
    const bytes = await new ApacheArrowChunkAssembler().assemble([
      { index: 0, rowOffset: 0, rowCount: 2, bytes: first },
      { index: 1, rowOffset: 2, rowCount: 1, bytes: second },
    ]);
    expect(tableFromIPC(bytes).numRows).toBe(3);
  });

  it('encodes complete Snowflake JSONv2 rows deterministically', async () => {
    const encoder = new ApacheArrowJsonV2Encoder();
    const columns = [
      { name: 'ID', type: 'fixed', nullable: false, precision: 38, scale: 0 },
      { name: 'LABEL', type: 'text', nullable: true, precision: null, scale: null },
    ];
    const rows = [
      ['1', 'one'],
      ['2', null],
    ];
    const left = await encoder.encode(columns, rows);
    const right = await encoder.encode(columns, rows);
    expect(left).toEqual(right);
    const table = tableFromIPC(left);
    expect(table.numRows).toBe(2);
    expect(table.schema.fields.map((field) => field.name)).toEqual(['ID', 'LABEL']);
  });
});
