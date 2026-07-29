import { describe, expect, it, vi } from 'vitest';
import type { Engine } from '../src/core/engine.ts';
import { Notebook } from '../src/ui/notebook.ts';

describe('notebook artifact ownership', () => {
  it('deleting a cell also drops its materialized engine relation', async () => {
    const drop = vi.fn().mockResolvedValue(undefined);
    const notebook = new Notebook({ drop } as unknown as Engine);
    const cell = notebook.addCell('sql');

    notebook.deleteCell(cell.id);
    await vi.waitFor(() => expect(drop).toHaveBeenCalledWith(`cell_${cell.id}`));

    expect(notebook.get().cells).toEqual([]);
  });
});
