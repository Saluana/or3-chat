import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runForegroundCommand } from '../cloud/wizard/package-manager';

/** Only the dev launcher supplies this map, after successful local builds. */
export function resolveDevProviderModule(
    moduleId: string,
    env: NodeJS.ProcessEnv = process.env,
): string {
    if (env.NODE_ENV !== 'development' || env.OR3_LOCAL_PROVIDERS === 'false') return moduleId;
    try {
        const modules = JSON.parse(env.OR3_DEV_PROVIDER_MODULES ?? '{}');
        const entry = modules[moduleId];
        if (typeof entry === 'string' && existsSync(entry)) return entry;
        if (entry) console.warn(`[or3-local] ${moduleId}: local build disappeared; using installed package.`);
    } catch {
        console.warn('[or3-local] Invalid dev provider map; using installed packages.');
    }
    return moduleId;
}

/** Rebuild before selection: a stale or partially failed dist is never selected. */
export async function prepareLocalProviders(
    projectRoot: string,
    env: NodeJS.ProcessEnv = process.env,
    build: (cwd: string, name: string) => Promise<void> = (cwd, name) =>
        runForegroundCommand({ command: 'bun', args: ['run', 'build'] }, { cwd, label: name, env }),
): Promise<Record<string, string>> {
    const modules: Record<string, string> = {};
    if (env.OR3_LOCAL_PROVIDERS === 'false' || (env.CI && env.OR3_LOCAL_PROVIDERS !== 'true')) {
        console.log('[or3-local] Using installed providers (local builds disabled).');
        return modules;
    }
    const manifest = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8'));
    const dependencies = { ...manifest.dependencies, ...manifest.devDependencies, ...manifest.optionalDependencies };
    for (const name of Object.keys(dependencies).filter((name) => /^or3-provider-[a-z0-9-]+$/.test(name)).sort()) {
        const root = resolve(projectRoot, '..', name);
        try {
            const local = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
            if (local.name !== name) throw new Error('sibling package name does not match');
            const entry = local.exports?.['./nuxt']?.import;
            if (typeof entry !== 'string' || !entry.startsWith('./dist/')) {
                throw new Error('package does not export a built Nuxt module');
            }
            await build(root, name);
            const modulePath = resolve(root, entry);
            if (!existsSync(modulePath)) throw new Error('build did not produce the Nuxt module');
            modules[`${name}/nuxt`] = modulePath;
            console.log(`[or3-local] ${name}@${local.version}: ${modulePath}`);
        } catch (error) {
            console.warn(`[or3-local] ${name}: using installed package. Local provider unavailable: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    return modules;
}
