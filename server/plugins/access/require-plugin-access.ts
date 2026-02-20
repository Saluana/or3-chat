/**
 * Nitro autoloads everything in server/plugins and expects a default plugin export.
 * Access helpers were moved to server/utils/plugins/access/require-plugin-access.ts.
 * Keep this shim to avoid accidental build breaks if this file path is still discovered.
 */
export default defineNitroPlugin(() => {});
