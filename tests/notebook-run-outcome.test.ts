import { describe, expect, it, vi } from 'vitest';
import type { Engine } from '../src/core/engine.ts';
import { Notebook } from '../src/ui/notebook.ts';

function fakeEngine(overrides: Partial<Engine> = {}): Engine {
  return {
    exec: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue([{ value: 1 }]),
    explainPlan: vi.fn().mockResolvedValue(null),
    ...overrides,
  } as unknown as Engine;
}

describe('Notebook.runCell outcomes', () => {
  it('returns not-runnable for a missing or visual cell', async () => {
    const notebook = new Notebook(fakeEngine());
    expect(await notebook.runCell('missing')).toEqual({
      status: 'not-runnable',
      id: 'missing',
    });
    const chart = notebook.addCell('chart');
    expect(await notebook.runCell(chart.id)).toEqual({
      status: 'not-runnable',
      id: chart.id,
    });
  });

  it('returns a failure for a rejected reference graph', async () => {
    const notebook = new Notebook(fakeEngine());
    const cell = notebook.addCell('sql');
    notebook.patchCell(cell.id, { name: 'self', code: 'SELECT * FROM @self' });

    const outcome = await notebook.runCell(cell.id);

    expect(outcome.status).toBe('failure');
    if (outcome.status === 'failure') expect(outcome.error).toMatch(/references itself/i);
    expect(notebook.get().cells.find((candidate) => candidate.id === cell.id)).toMatchObject({
      status: 'error',
      lastResult: null,
    });
  });

  it('returns failure instead of swallowing an engine error', async () => {
    const engine = fakeEngine({
      exec: vi.fn().mockRejectedValue(new Error('bad relation')),
    } as Partial<Engine>);
    const notebook = new Notebook(engine);
    const cell = notebook.addCell('sql');
    notebook.patchCell(cell.id, { code: 'SELECT * FROM missing_table' });

    await expect(notebook.runCell(cell.id)).resolves.toEqual({
      status: 'failure',
      id: cell.id,
      error: 'bad relation',
    });
  });

  it('returns success only after the result is published', async () => {
    const notebook = new Notebook(fakeEngine());
    const cell = notebook.addCell('sql');
    notebook.patchCell(cell.id, { code: 'SHOW TABLES' });

    await expect(notebook.runCell(cell.id)).resolves.toEqual({
      status: 'success',
      id: cell.id,
    });
    expect(notebook.get().cells.find((candidate) => candidate.id === cell.id)).toMatchObject({
      status: 'success',
      lastResult: { rows: [{ value: 1 }], rowCount: 1 },
    });
  });

  it('marks direct introspection results non-referenceable and stops run all at the named cell', async () => {
    const engine = fakeEngine();
    const notebook = new Notebook(engine);
    const introspection = notebook.addCell('sql');
    notebook.patchCell(introspection.id, { name: 'catalog', code: 'SHOW TABLES' });
    const downstream = notebook.addCell('sql');
    notebook.patchCell(downstream.id, {
      name: 'uses_catalog',
      code: 'SELECT * FROM @catalog',
    });

    const outcome = await notebook.runAll();

    expect(outcome).toMatchObject({
      status: 'stopped',
      cellId: downstream.id,
      cellName: 'uses_catalog',
      outcome: { status: 'failure', id: downstream.id },
    });
    if (outcome.status === 'stopped' && outcome.outcome.status === 'failure') {
      expect(outcome.outcome.error).toMatch(/SHOW result.*cannot be referenced/i);
    }
    expect(engine.exec).not.toHaveBeenCalled();
  });

  it('stops a batch at the first failed cell and names it', async () => {
    const engine = fakeEngine({
      exec: vi.fn(async (sql: string) => {
        if (sql.includes('SELECT bad')) throw new Error('bad query');
      }),
    } as Partial<Engine>);
    const notebook = new Notebook(engine);
    const first = notebook.addCell('sql');
    notebook.patchCell(first.id, { name: 'first', code: 'SELECT 1' });
    const bad = notebook.addCell('sql');
    notebook.patchCell(bad.id, { name: 'broken_step', code: 'SELECT bad' });
    const never = notebook.addCell('sql');
    notebook.patchCell(never.id, { name: 'never_runs', code: 'SELECT 3' });

    await expect(notebook.runAll()).resolves.toEqual({
      status: 'stopped',
      cellId: bad.id,
      cellName: 'broken_step',
      outcome: { status: 'failure', id: bad.id, error: 'bad query' },
    });
    expect(engine.exec).toHaveBeenCalledTimes(2);
    expect(engine.exec).not.toHaveBeenCalledWith(
      expect.stringContaining('SELECT 3'),
      expect.anything(),
    );
  });
});
