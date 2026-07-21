#!/usr/bin/env bun
/**
 * Verifies the reviewed manager-only default promotion. Hook Runtime V2,
 * ModuleV2Loader, and isolation must remain independently default-off.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '../..');

const DEFAULT_OFF_FLAG_KEYS = [
    'hookEngineV2Enabled',
    'pluginModuleLoaderV2Enabled',
    'pluginIsolationEnabled',
] as const;

const DEFAULT_OFF_ENV_KEYS = [
    'OR3_HOOK_ENGINE_V2_ENABLED',
    'OR3_PLUGIN_MODULE_LOADER_V2_ENABLED',
    'OR3_PLUGIN_ISOLATION_ENABLED',
] as const;

function main(): void {
    const failures: string[] = [];
    const defaultsSource = readFileSync(
        resolve(repoRoot, 'utils/or3-cloud-config.ts'),
        'utf8'
    );
    const resolveSource = readFileSync(
        resolve(repoRoot, 'server/admin/config/resolve-config.ts'),
        'utf8'
    );

    if (!/pluginRuntimeV2Enabled\s*:\s*true\s*,/.test(defaultsSource)) {
        failures.push('utils/or3-cloud-config.ts must default pluginRuntimeV2Enabled: true');
    }
    if (!/pluginContributionV2Surfaces\s*:\s*\[\]\s*,/.test(defaultsSource)) {
        failures.push('utils/or3-cloud-config.ts must default contribution surfaces to []');
    }
    const managerEnvIndex = resolveSource.indexOf('OR3_PLUGIN_RUNTIME_V2_ENABLED');
    const managerEnvWindow = resolveSource.slice(managerEnvIndex, managerEnvIndex + 160);
    if (managerEnvIndex < 0 || !/\btrue\b/.test(managerEnvWindow)) {
        failures.push(
            'resolve-config.ts must use envBool(OR3_PLUGIN_RUNTIME_V2_ENABLED, true)'
        );
    }
    const surfacesEnvIndex = resolveSource.indexOf('OR3_PLUGIN_CONTRIBUTION_V2_SURFACES');
    const surfacesEnvWindow = resolveSource.slice(surfacesEnvIndex, surfacesEnvIndex + 260);
    if (surfacesEnvIndex < 0 || !/:\s*\[\]/.test(surfacesEnvWindow)) {
        failures.push(
            'resolve-config.ts must keep OR3_PLUGIN_CONTRIBUTION_V2_SURFACES empty by default'
        );
    }

    for (const key of DEFAULT_OFF_FLAG_KEYS) {
        if (!new RegExp(`${key}\\s*:\\s*false\\s*,`).test(defaultsSource)) {
            failures.push(`utils/or3-cloud-config.ts must default ${key}: false`);
        }
        if (new RegExp(`${key}\\s*:\\s*true\\s*,`).test(defaultsSource)) {
            failures.push(`utils/or3-cloud-config.ts must not default ${key}: true`);
        }
    }

    for (const envKey of DEFAULT_OFF_ENV_KEYS) {
        const index = resolveSource.indexOf(envKey);
        if (index < 0) {
            failures.push(`resolve-config.ts missing ${envKey}`);
            continue;
        }
        const window = resolveSource.slice(index, index + 160);
        if (!/\bfalse\b/.test(window)) {
            failures.push(
                `resolve-config.ts must use envBool(${envKey}, false) as the production default`
            );
        }
        if (/\btrue\b/.test(window) && !/\bfalse\b/.test(window)) {
            failures.push(`resolve-config.ts must not default ${envKey} via true`);
        }
    }

    if (failures.length) {
        for (const failure of failures) console.error(`[milestone-9-defaults] ${failure}`);
        process.exitCode = 1;
        return;
    }
    console.log(
        '[milestone-9-defaults] manager defaults on; hook, module-loader, and isolation defaults remain off'
    );
}

main();
