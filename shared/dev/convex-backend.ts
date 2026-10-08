import { dirname, resolve } from 'node:path';
import { configDotenv } from 'dotenv';
import { runForegroundCommand } from '../cloud/wizard/package-manager';
import { resolveModuleEntry } from '../config/module-resolution';

/** Source startup owns deployment; Nuxt builds and Nitro restarts only verify. */
export async function prepareConvexBackend(
    projectRoot: string,
    env: NodeJS.ProcessEnv = process.env,
    localModules: Record<string, string> = {},
): Promise<NodeJS.ProcessEnv> {
    const fileEnv: Record<string, string> = {};
    configDotenv({ path: resolve(projectRoot, '.env'), processEnv: fileEnv, quiet: true });
    const startupEnv = { ...fileEnv, ...env };
    if (startupEnv.OR3_WIZARD_UI_ENABLED === 'true') return startupEnv;
    const enabled = (value: string | undefined) => value?.trim().toLowerCase() === 'true';
    const authEnabled = enabled(startupEnv.SSR_AUTH_ENABLED);
    const syncProvider = startupEnv.OR3_SYNC_PROVIDER?.trim().toLowerCase() || 'convex';
    const storageFlag = startupEnv.OR3_CLOUD_STORAGE_ENABLED ?? startupEnv.OR3_STORAGE_ENABLED;
    const storageEnabled = (authEnabled && storageFlag !== 'false') || enabled(storageFlag);
    const storageProvider = startupEnv.NUXT_PUBLIC_STORAGE_PROVIDER ?? 'convex';
    const connectProvider = startupEnv.OR3_CONNECT_PROVIDER || syncProvider;
    const syncEnabled = authEnabled || enabled(startupEnv.OR3_CLOUD_SYNC_ENABLED ?? startupEnv.OR3_SYNC_ENABLED);
    const usesConvex = (syncEnabled && syncProvider === 'convex') || (storageEnabled && storageProvider === 'convex') || (authEnabled && enabled(startupEnv.OR3_CONNECT_ENABLED) && connectProvider === 'convex');
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
