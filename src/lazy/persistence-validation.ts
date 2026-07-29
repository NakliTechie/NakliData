// Complete `.naklidata` validation rides a lazy chunk because every entry point
// that consumes untrusted workbook state is already asynchronous. Re-exporting
// the pure implementation keeps tests able to exercise it synchronously while
// removing its cost from the always-on inlined shell.

export { parse, validateNakliDataFile } from '../core/persistence.ts';
