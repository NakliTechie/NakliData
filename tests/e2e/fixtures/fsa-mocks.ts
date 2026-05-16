// Install fakes for the File System Access pickers via addInitScript so
// they're in place before any page script runs. Tests stage files into
// `window.__fsa.files` ahead of opening, and read written bytes out of
// `window.__fsa.writes` afterwards.
//
// Pattern borrowed from OpenPlanter's `injectTauriMocks` in
// frontend/e2e/*.spec.ts — same idea, different boundary (browser API
// rather than IPC).

import type { Page } from '@playwright/test';

export interface FsaInstalled {
  /** Stage a single file the next showOpenFilePicker call will return. */
  stageOpenFile: (name: string, bytes: Uint8Array | string, type?: string) => Promise<void>;
  /** Read the most recently written file (by suggestedName) as text. */
  readLatestWriteText: () => Promise<{ name: string; text: string } | null>;
  /** Read all writes since install. */
  readAllWrites: () => Promise<Array<{ name: string; bytes: number[] }>>;
}

export async function installFsaMocks(page: Page): Promise<FsaInstalled> {
  await page.addInitScript(() => {
    interface StagedFile {
      name: string;
      bytes: Uint8Array;
      type: string;
    }
    interface WriteRecord {
      name: string;
      bytes: number[];
    }
    const fsa = {
      openQueue: [] as StagedFile[],
      writes: [] as WriteRecord[],
    };
    (globalThis as unknown as { __fsa: typeof fsa }).__fsa = fsa;

    function makeFakeFileHandle(staged: StagedFile): FileSystemFileHandle {
      const file = new File([new Uint8Array(staged.bytes)], staged.name, { type: staged.type });
      const writable = {
        async write(data: Blob | ArrayBuffer | Uint8Array | string) {
          let bytes: Uint8Array;
          if (data instanceof Blob) {
            const buf = await data.arrayBuffer();
            bytes = new Uint8Array(buf);
          } else if (data instanceof ArrayBuffer) {
            bytes = new Uint8Array(data);
          } else if (data instanceof Uint8Array) {
            bytes = data;
          } else {
            bytes = new TextEncoder().encode(String(data));
          }
          fsa.writes.push({ name: staged.name, bytes: Array.from(bytes) });
        },
        async close() {},
      };
      return {
        kind: 'file',
        name: staged.name,
        getFile: async () => file,
        createWritable: async () => writable,
        queryPermission: async () => 'granted',
        requestPermission: async () => 'granted',
        async *entries() {},
        async *keys() {},
        async *values() {},
        isSameEntry: async () => false,
      } as unknown as FileSystemFileHandle;
    }

    function makeFakeWritable(suggestedName: string) {
      return {
        kind: 'file',
        name: suggestedName,
        async getFile() {
          return new File([], suggestedName);
        },
        async createWritable() {
          return {
            async write(data: Blob | ArrayBuffer | Uint8Array | string) {
              let bytes: Uint8Array;
              if (data instanceof Blob) {
                const buf = await data.arrayBuffer();
                bytes = new Uint8Array(buf);
              } else if (data instanceof ArrayBuffer) {
                bytes = new Uint8Array(data);
              } else if (data instanceof Uint8Array) {
                bytes = data;
              } else {
                bytes = new TextEncoder().encode(String(data));
              }
              fsa.writes.push({ name: suggestedName, bytes: Array.from(bytes) });
            },
            async close() {},
          };
        },
        async queryPermission() {
          return 'granted';
        },
        async requestPermission() {
          return 'granted';
        },
      } as unknown as FileSystemFileHandle;
    }

    (window as unknown as { showOpenFilePicker: unknown }).showOpenFilePicker = async () => {
      const staged = fsa.openQueue.shift();
      if (!staged) throw new DOMException('AbortError', 'AbortError');
      return [makeFakeFileHandle(staged)];
    };

    (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = async (opts: {
      suggestedName?: string;
    }) => {
      const name = opts?.suggestedName ?? 'untitled';
      return makeFakeWritable(name);
    };
  });

  return {
    async stageOpenFile(
      name: string,
      bytes: Uint8Array | string,
      type = 'application/octet-stream',
    ) {
      const arr =
        typeof bytes === 'string' ? Array.from(new TextEncoder().encode(bytes)) : Array.from(bytes);
      await page.evaluate(
        ({ name, arr, type }) => {
          const fsa = (
            globalThis as unknown as {
              __fsa: { openQueue: Array<{ name: string; bytes: Uint8Array; type: string }> };
            }
          ).__fsa;
          fsa.openQueue.push({ name, bytes: new Uint8Array(arr), type });
        },
        { name, arr, type },
      );
    },
    async readLatestWriteText() {
      const last = await page.evaluate(() => {
        const fsa = (
          globalThis as unknown as {
            __fsa: { writes: Array<{ name: string; bytes: number[] }> };
          }
        ).__fsa;
        if (fsa.writes.length === 0) return null;
        return fsa.writes[fsa.writes.length - 1];
      });
      if (!last) return null;
      return { name: last.name, text: new TextDecoder().decode(new Uint8Array(last.bytes)) };
    },
    async readAllWrites() {
      return await page.evaluate(() => {
        const fsa = (
          globalThis as unknown as {
            __fsa: { writes: Array<{ name: string; bytes: number[] }> };
          }
        ).__fsa;
        return [...fsa.writes];
      });
    },
  };
}
