// Compatibility barrel. Production mounts load the implementation through the
// `iceberg-rest-client` lazy chunk so defensive HTTP parsing stays off-shell.
export * from '../../lazy/iceberg-rest-client.ts';
