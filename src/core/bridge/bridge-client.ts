// Compatibility barrel for code/tests that imported the original client path.
// Production surfaces load the implementation from the `bridge-client` lazy
// chunk so protocol validation and bounded streaming stay out of the shell.
export * from '../../lazy/bridge-client.ts';
