import { requiredProviderModules } from '../cloud/provider-compatibility';
import { buildOr3CloudConfigFromEnv } from '../../server/admin/config/resolve-config';

export function usesSqliteProvider(env: NodeJS.ProcessEnv): boolean {
    if (env.SSR_AUTH_ENABLED?.trim().toLowerCase() !== 'true') return false;
    return requiredProviderModules(
        buildOr3CloudConfigFromEnv(env, { strict: false }), env,
    ).some(({ moduleId }) => moduleId === 'or3-provider-sqlite/nuxt');
}

export function usesBunSqlite(env: NodeJS.ProcessEnv): boolean {
    const driver = env.OR3_SQLITE_DRIVER?.trim().toLowerCase();
    return (driver === 'bun' || driver === 'bun:sqlite') && usesSqliteProvider(env);
}

/** Select the application runtime independently of its package manager. */
export function nuxtRuntime(env: NodeJS.ProcessEnv = process.env): string {
    if (usesBunSqlite(env)) return process.versions.bun ? process.execPath : 'bun';
    return process.versions.bun ? 'node' : process.execPath;
}
