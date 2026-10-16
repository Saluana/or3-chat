import { dirname, resolve } from 'node:path';
import { configDotenv } from 'dotenv';
import { runForegroundCommand } from '../cloud/wizard/package-manager';
import { resolveModuleEntry } from '../config/module-resolution';
import { requiredProviderModules } from '../cloud/provider-compatibility';
import { buildOr3CloudConfigFromEnv } from '../../server/admin/config/resolve-config';
import { readEnvAlias } from '../cloud/env-contract';

/** Source startup owns deployment; Nuxt builds and Nitro restarts only verify. */
export async function prepareConvexBackend(
    projectRoot: string,
    env: NodeJS.ProcessEnv = process.env,
    localModules: Record<string, string> = {},
): Promise<NodeJS.ProcessEnv> {
    const fileEnv: Record<string, string> = {};
    configDotenv({ path: resolve(projectRoot, '.env'), processEnv: fileEnv, quiet: true });
    const startupEnv = { ...fileEnv, ...env };
    // Auth workspace provisioning still needs its store when sync transfer is
    // disabled. Use the same selections and alias precedence as Nuxt startup.
    const authenticatedConvex = requiredProviderModules(
        buildOr3CloudConfigFromEnv(startupEnv, { strict: false }), startupEnv,
    ).some(({ moduleId }) => moduleId === 'or3-provider-convex/nuxt');
    // Preserve source preview's explicit direct-backend update contract even
    // when SSR auth is off. Disabled aliases never opt into that preparation.
    const directConvex =
        (readEnvAlias(startupEnv, 'syncEnabled') === 'true' &&
            (startupEnv.OR3_SYNC_PROVIDER ?? 'convex') === 'convex') ||
        (readEnvAlias(startupEnv, 'storageEnabled') === 'true' &&
            (startupEnv.NUXT_PUBLIC_STORAGE_PROVIDER ?? 'convex') === 'convex');
    const usesConvex = authenticatedConvex || directConvex;
    if (!usesConvex) return startupEnv;
    const module = resolveModuleEntry(localModules['or3-provider-convex/nuxt'] ?? 'or3-provider-convex/nuxt', projectRoot);
    if (!module.ok) throw new Error(`Convex backend updater: ${module.message}`);
    const cli = resolve(dirname(module.entry), '..', 'scripts/init.mjs');
    await runForegroundCommand({ command: process.versions.bun ? 'node' : process.execPath, args: [cli, 'deploy'] }, {
        cwd: projectRoot,
        env: startupEnv,
        label: 'Verify or update the selected Convex backend',
    });
    return startupEnv;
}
