import { beforeEach, describe, expect, it, vi } from 'vitest';

const putHandle = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/core/handles.ts', () => ({
  PermissionLostError: class PermissionLostError extends Error {},
  ensureReadPermission: vi.fn().mockResolvedValue(true),
  newHandleId: () => 'new-handle',
  putHandle,
}));

const { mountFolder } = await import('../src/core/mount.ts');

function directory(
  entries: Array<[string, { kind: 'file' | 'directory'; getFile?: () => Promise<File> }]>,
): FileSystemDirectoryHandle {
  return {
    kind: 'directory',
    name: 'picked-folder',
    async *entries() {
      for (const entry of entries) yield entry;
    },
  } as unknown as FileSystemDirectoryHandle;
}

beforeEach(() => {
  putHandle.mockClear();
});

describe('folder handle ownership', () => {
  it('does not persist a handle for an empty folder', async () => {
    await expect(mountFolder({} as never, directory([]))).rejects.toThrow(
      /No supported files found/,
    );
    expect(putHandle).not.toHaveBeenCalled();
  });

  it('does not persist a handle when every recognized file fails to read', async () => {
    const handle = directory([
      [
        'broken.csv',
        {
          kind: 'file',
          getFile: async () => {
            throw new DOMException('gone', 'NotFoundError');
          },
        },
      ],
    ]);
    await expect(mountFolder({} as never, handle)).rejects.toThrow(/none could be loaded/i);
    expect(putHandle).not.toHaveBeenCalled();
  });
});
