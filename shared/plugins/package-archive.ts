/**
 * Host-facing deterministic package archive.
 *
 * The canonical implementation lives in `@or3/plugin-sdk` at
 * `packages/plugin-sdk/src/cli/archive.ts` (exported as
 * `@or3/plugin-sdk/package-archive`) so the host and the standalone
 * `or3-plugin` CLI share one writer/reader. This module is kept as the host
 * import path for existing server/CLI/test code.
 */
export * from '@or3/plugin-sdk/package-archive';
