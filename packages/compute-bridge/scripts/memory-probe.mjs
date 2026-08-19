import { tableFromArrays, tableFromIPC, tableToIPC } from 'apache-arrow';
import { ApacheArrowChunkAssembler, ApacheArrowJsonV2Encoder } from '../src/arrow.ts';

const MIN_TARGET_BYTES = 1024 * 1024;
const MAX_TARGET_BYTES = 32 * 1024 * 1024;
const DEFAULT_TARGET_BYTES = MAX_TARGET_BYTES;

const targetBytes = positiveInteger(
  process.env.BRIDGE_MEMORY_PROBE_BYTES,
  DEFAULT_TARGET_BYTES,
  MAX_TARGET_BYTES,
);

const result = {
  probe: 'naklidata-compute-bridge-memory',
  version: 2,
  runtime: process.version,
  targetBytes,
  targetKind: 'encoded-result-ceiling',
  databricks: await probeDatabricks(targetBytes),
  snowflake: await probeSnowflake(targetBytes),
  caveat:
    'Node retained-memory snapshots are diagnostic only; deployed Cloudflare peak heap remains required.',
};

assertResultCeiling(result.databricks, result.snowflake, targetBytes);
assertRetainedBuffers(result.databricks, result.snowflake);
process.stdout.write(`${JSON.stringify(result)}\n`);

async function probeDatabricks(target) {
  collect();
  const baseline = memory();
  const chunkCount = 4;
  const framingBudget = Math.min(64 * 1024, Math.floor(target / 10));
  const rowsPerChunk = Math.max(
    1,
    Math.floor((target - framingBudget) / (chunkCount * Int32Array.BYTES_PER_ELEMENT)),
  );
  const chunks = [];
  let rowOffset = 0;
  for (let index = 0; index < chunkCount; index++) {
    const values = new Int32Array(rowsPerChunk);
    for (let row = 0; row < rowsPerChunk; row++) values[row] = rowOffset + row;
    const bytes = tableToIPC(tableFromArrays({ value: values }), 'stream');
    chunks.push({ index, rowOffset, rowCount: rowsPerChunk, bytes });
    rowOffset += rowsPerChunk;
  }
  collect();
  const input = memory();
  const output = await new ApacheArrowChunkAssembler().assemble(chunks);
  const parsedRows = tableFromIPC(output).numRows;
  collect();
  const assembled = memory();
  if (parsedRows !== rowOffset) throw new Error('Databricks memory probe row count mismatch.');
  return summary(baseline, input, assembled, {
    inputBytes: chunks.reduce((sum, chunk) => sum + chunk.bytes.byteLength, 0),
    outputBytes: output.byteLength,
    rowCount: parsedRows,
    chunkCount,
  });
}

async function probeSnowflake(target) {
  collect();
  const baseline = memory();
  const payload = 'x'.repeat(63);
  // Arrow retains two UTF-8 offset entries plus validity and stream framing.
  // Eighty bytes per row keeps the encoded result close to, but below, the
  // configured ceiling for both the default probe and the 1 MiB lower bound.
  const rowCount = Math.max(1, Math.floor(target / 80));
  const rows = Array.from({ length: rowCount }, (_, index) => [String(index), payload]);
  collect();
  const input = memory();
  const output = await new ApacheArrowJsonV2Encoder().encode(
    [
      { name: 'row_id', type: 'FIXED', nullable: false, precision: 38, scale: 0 },
      { name: 'payload', type: 'TEXT', nullable: false, precision: null, scale: null },
    ],
    rows,
  );
  const parsedRows = tableFromIPC(output).numRows;
  collect();
  const assembled = memory();
  if (parsedRows !== rowCount) throw new Error('Snowflake memory probe row count mismatch.');
  return summary(baseline, input, assembled, {
    inputTextBytes: rows.reduce(
      (sum, row) => sum + (row[0]?.length ?? 0) + (row[1]?.length ?? 0),
      0,
    ),
    outputBytes: output.byteLength,
    rowCount: parsedRows,
    columnCount: 2,
  });
}

function assertResultCeiling(databricks, snowflake, target) {
  for (const [adapter, result] of Object.entries({ databricks, snowflake })) {
    if (result.outputBytes > target) {
      throw new Error(`${adapter} output exceeds the configured result ceiling.`);
    }
    if (target >= 1024 * 1024 && result.outputBytes < Math.floor(target * 0.85)) {
      throw new Error(`${adapter} output does not exercise enough of the result ceiling.`);
    }
  }
}

function summary(baseline, input, assembled, resultShape) {
  return {
    ...resultShape,
    retainedBytes: {
      afterInput: delta(input, baseline),
      afterAssembly: delta(assembled, baseline),
    },
  };
}

function memory() {
  const current = process.memoryUsage();
  return {
    rss: current.rss,
    heapUsed: current.heapUsed,
    external: current.external,
    arrayBuffers: current.arrayBuffers,
  };
}

function delta(current, baseline) {
  return Object.fromEntries(
    Object.entries(current).map(([key, value]) => [key, Math.max(0, value - baseline[key])]),
  );
}

function collect() {
  if (typeof globalThis.gc !== 'function') {
    throw new Error('Memory probe requires Node --expose-gc.');
  }
  globalThis.gc();
}

function assertRetainedBuffers(databricks, snowflake) {
  const databricksLimit = databricks.inputBytes + databricks.outputBytes + 1024 * 1024;
  if (databricks.retainedBytes.afterAssembly.arrayBuffers > databricksLimit) {
    throw new Error('Databricks retained ArrayBuffers exceed input plus output headroom.');
  }
  const snowflakeLimit = Math.ceil(snowflake.outputBytes * 1.5) + 1024 * 1024;
  if (snowflake.retainedBytes.afterAssembly.arrayBuffers > snowflakeLimit) {
    throw new Error('Snowflake retained ArrayBuffers exceed output headroom.');
  }
}

function positiveInteger(value, fallback, maximum) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new Error('BRIDGE_MEMORY_PROBE_BYTES must be an integer.');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < MIN_TARGET_BYTES || parsed > maximum) {
    throw new Error(`BRIDGE_MEMORY_PROBE_BYTES must be from ${MIN_TARGET_BYTES} to ${maximum}.`);
  }
  return parsed;
}
