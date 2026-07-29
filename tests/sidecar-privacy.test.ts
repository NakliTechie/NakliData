import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  configureCloudActionConfirmation,
  payloadCategories,
  prepareCloudDispatch,
} from '../src/core/sidecar/client.ts';
import type { SidecarError } from '../src/core/sidecar/types.ts';

afterEach(() => {
  configureCloudActionConfirmation(null);
});

describe('cloud sidecar privacy boundary', () => {
  it('shows provider and actual payload categories after stripping samples', async () => {
    const disclosures: unknown[] = [];
    configureCloudActionConfirmation((disclosure) => {
      disclosures.push(disclosure);
      return true;
    });

    const protectedJob = await prepareCloudDispatch(
      {
        kind: 'disambiguate-type',
        columnName: 'customer_email',
        sqlType: 'VARCHAR',
        samples: ['secret@example.com'],
        candidates: [{ typeId: 'email', displayName: 'Email' }],
      },
      { provider: 'custom', model: 'test-model', customEndpoint: 'https://models.example.test' },
    );

    expect(protectedJob.kind).toBe('disambiguate-type');
    if (protectedJob.kind !== 'disambiguate-type') throw new Error('unexpected kind');
    expect(protectedJob.samples).toEqual([]);
    expect(disclosures).toEqual([
      {
        provider: 'custom',
        model: 'test-model',
        payloadCategories: ['column name', 'SQL type', 'candidate semantic types'],
      },
    ]);
  });

  it('blocks value-dependent cloud jobs before transport or confirmation', async () => {
    const confirm = vi.fn(() => true);
    configureCloudActionConfirmation(confirm);

    await expect(
      prepareCloudDispatch(
        {
          kind: 'summarise-result',
          sql: 'SELECT amount FROM orders',
          columns: ['amount'],
          sampleRows: [{ amount: '100' }],
          rowCount: 1,
        },
        {
          provider: 'custom',
          model: 'test-model',
          customEndpoint: 'https://models.example.test',
        },
      ),
    ).rejects.toMatchObject({ kind: 'privacy' } satisfies Partial<SidecarError>);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('fails closed when disclosure UI is unavailable or the user cancels', async () => {
    const job = {
      kind: 'nl-to-sql' as const,
      question: 'count orders',
      tables: [{ name: 'orders', columns: ['id'] }],
    };
    await expect(
      prepareCloudDispatch(job, {
        provider: 'custom',
        model: 'test-model',
        customEndpoint: 'https://models.example.test',
      }),
    ).rejects.toThrow(/disclosure is unavailable/i);

    configureCloudActionConfirmation(() => false);
    await expect(
      prepareCloudDispatch(job, {
        provider: 'custom',
        model: 'test-model',
        customEndpoint: 'https://models.example.test',
      }),
    ).rejects.toThrow(/cancelled.*No request was sent/i);
  });

  it('keeps local jobs and in-process test transports out of the cloud gate', async () => {
    const job = {
      kind: 'define-type' as const,
      columnName: 'email',
      sqlType: 'VARCHAR',
      samples: ['a@example.com'],
    };
    await expect(
      prepareCloudDispatch(job, { provider: 'local', model: 'local-model' }),
    ).resolves.toBe(job);
    await expect(
      prepareCloudDispatch(job, {
        provider: 'openai',
        model: 'stub',
        transport: async () => '{}',
      }),
    ).resolves.toBe(job);
  });

  it('describes row-bearing jobs honestly', () => {
    expect(
      payloadCategories({
        kind: 'propose-merge',
        pairs: [{ a: 'Acme', b: 'ACME', aCount: 2, bCount: 1 }],
      }),
    ).toEqual(['raw value pairs', 'value counts']);
  });
});
