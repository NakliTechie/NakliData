// Type declaration for the Emscripten-generated ReadStat glue
// (readstat-glue.js). The glue is a MODULARIZE=1 EXPORT_ES6 factory that
// resolves to an initialised module once the wasm is instantiated.
// Regenerate both files with vendor/readstat/build.sh — see README.md.

export interface ReadStatModule {
  _malloc(size: number): number;
  _free(ptr: number): void;
  HEAPU8: Uint8Array;
  ccall(
    name: string,
    returnType: 'number',
    argTypes: Array<'number' | 'string'>,
    args: Array<number | string>,
  ): number;
  ccall(
    name: string,
    returnType: 'string',
    argTypes: Array<'number' | 'string'>,
    args: Array<number | string>,
  ): string;
}

export interface ReadStatModuleOptions {
  locateFile?: (path: string) => string;
  wasmBinary?: Uint8Array;
}

declare function createReadStat(options?: ReadStatModuleOptions): Promise<ReadStatModule>;
export default createReadStat;
