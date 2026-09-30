/**
 * Extended health checks for `or3-cloud doctor`.
 * Kept separate from the CLI entry so or3-cloud.ts stays dispatch-focused.
 */
import { accessSync, constants, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { preflightConvex } from '../../shared/cloud/wizard/deploy';
import { isPortAvailable as sharedIsPortAvailable } from '../../shared/cloud/wizard/dev-server';
import { providerIdToModuleId, requiredProviderModules } from '../../shared/cloud/provider-compatibility';
import { resolveModuleEntry } from '../../shared/config/module-resolution';
import { readProviderMetadata } from '../../shared/cloud/provider-metadata';
import type { Or3CloudConfig } from '../../types/or3-cloud-config';

export type DoctorCheckResult = {
    lines: string[];
    /** Hard failures (missing required packages). Warnings do not flip this. */
    exitCode: number;
};

export function providerPackageInstalled(
    providerId: string,
    cwd = process.cwd()
): boolean {
    const moduleId = providerIdToModuleId(providerId);
    return !moduleId || resolveModuleEntry(moduleId, cwd).ok;
}

export function checkWritableDir(pathValue: string): boolean {
    try {
        const absolute = resolve(pathValue);
        // File paths: check parent dir; directory paths: check themselves.
        const dirPath = existsSync(absolute)
            ? absolute
            : dirname(absolute);
        accessSync(dirPath, constants.W_OK);
        return true;
    } catch {
        return false;
    }
}

export const isPortAvailable = sharedIsPortAvailable;

export async function runDoctorChecks(input: {
    config: Or3CloudConfig;
    envMap: Record<string, string>;
    cwd?: string;
}): Promise<DoctorCheckResult> {
    const cwd = input.cwd ?? process.cwd();
    const { config, envMap: map } = input;
    const lines: string[] = [];
    let exitCode = 0;

    const authProvider = config.auth.provider;
    const syncProvider = config.sync.provider;

    for (const { moduleId, setting } of requiredProviderModules(config, map)) {
        const result = resolveModuleEntry(moduleId, cwd);
        lines.push(result.ok
            ? `  ✅ ${setting}: ${moduleId} — module entry resolved`
            : `  ❌ ${setting} requires ${moduleId}. ${result.message} Install/build the selected provider.`);
        if (!result.ok) exitCode = 1;
    }
    if (config.auth.enabled && map.OR3_WIZARD_UI_ENABLED !== 'true' && !map.OR3_PLUGIN_WATCH_ROOT) {
        try {
            const metadata = readProviderMetadata(cwd);
            lines.push(...metadata.warnings.map((warning) => `  ⚠️  ${warning}`));
            for (const moduleId of metadata.modules) {
                const result = resolveModuleEntry(moduleId, cwd);
                if (!result.ok) lines.push(`  ⚠️  Supplemental module ${moduleId}: ${result.message}`);
            }
        } catch (error) {
            lines.push(`  ❌ ${error instanceof Error ? error.message : 'Invalid provider metadata.'}`);
            exitCode = 1;
        }
    }

    if (syncProvider === 'sqlite' && config.sync.enabled) {
        const sqliteDriver =
            map.OR3_SQLITE_DRIVER?.trim().toLowerCase() || 'better-sqlite3';
        if (sqliteDriver === 'better-sqlite3' || sqliteDriver === 'bun') {
            const dbPath = map.OR3_SQLITE_DB_PATH || './.data/or3-sync.sqlite';
            const dir = resolve(cwd, dbPath);
            const ok = checkWritableDir(dir);
            lines.push(
                ok
                    ? `  ✅ SQLite sync DB path accessible`
                    : `  ⚠️  SQLite sync DB path may not be writable: ${dir}`
            );
        } else if (sqliteDriver === 'turso') {
            lines.push(
                map.OR3_SQLITE_TURSO_URL && map.OR3_SQLITE_TURSO_AUTH_TOKEN
                    ? '  ✅ Turso SQLite runtime configured'
                    : '  ⚠️  Turso SQLite runtime requires OR3_SQLITE_TURSO_URL and OR3_SQLITE_TURSO_AUTH_TOKEN'
            );
        } else if (sqliteDriver === 'd1') {
            lines.push(
                map.OR3_SQLITE_D1_BINDING
                    ? `  ✅ Cloudflare D1 binding configured: ${map.OR3_SQLITE_D1_BINDING}`
                    : '  ⚠️  Cloudflare D1 runtime requires OR3_SQLITE_D1_BINDING'
            );
        }
    }
    if (authProvider === 'basic-auth') {
        const dbPath =
            map.OR3_BASIC_AUTH_DB_PATH || './.data/or3-basic-auth.sqlite';
        const dir = resolve(cwd, dbPath);
        const ok = checkWritableDir(dir);
        lines.push(
            ok
                ? `  ✅ Basic-auth DB path accessible`
                : `  ⚠️  Basic-auth DB path may not be writable: ${dir}`
        );
    }
    if (storageProvider === 'fs' && config.storage.enabled) {
        const fsRoot = map.OR3_STORAGE_FS_ROOT || '/tmp/or3-storage';
        const ok = checkWritableDir(fsRoot);
        lines.push(
            ok
                ? `  ✅ FS storage root directory accessible`
                : `  ⚠️  FS storage root may not be writable: ${fsRoot}`
        );
    }

    const port = Number(process.env.PORT) || 3000;
    const portFree = await isPortAvailable(port);
    lines.push(
        portFree
            ? `  ✅ Port ${port} is available`
            : `  ⚠️  Port ${port} is already in use — another dev server may fail to start.`
    );

    if (
        (syncProvider === 'convex' && config.sync.enabled) ||
        (storageProvider === 'convex' && config.storage.enabled)
    ) {
        const convexWarnings = await preflightConvex(cwd);
        if (convexWarnings.length === 0) {
            lines.push('  ✅ Convex CLI is accessible and project detected');
        } else {
            lines.push(`  ⚠️  Convex preflight:`);
            for (const warning of convexWarnings) {
                lines.push(`       - ${warning}`);
            }
        }
    }

    return { lines, exitCode };
}
