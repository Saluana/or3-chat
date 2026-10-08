import { readFile, realpath } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

/** Resolve the exact provider bytes exercised by disposable cloud profiles. */
export async function resolveQualificationProvider(
    app: string, name: 'or3-provider-sqlite' | 'or3-provider-convex' | 'or3-provider-fs',
    development: boolean, env: Record<string, string | undefined> = process.env,
) {
    const sourceKey = name === 'or3-provider-sqlite' ? 'OR3_PROJECT_SQLITE_SOURCE'
        : name === 'or3-provider-convex' ? 'OR3_PROJECT_CONVEX_SOURCE' : 'OR3_PROJECT_FS_SOURCE';
    const path = development ? resolve(env[sourceKey] ?? join(app, '..', name)) : join(app, 'node_modules', name);
    const pkg = JSON.parse(await readFile(join(path, 'package.json'), 'utf8')) as { name: string; version: string };
    if (pkg.name !== name) throw new Error(`Wrong provider package at ${path}`);
    if (!development) {
        const manifest = JSON.parse(await readFile(join(app, 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
        if (manifest.dependencies[name] !== pkg.version) throw new Error(`Installed ${name} ${pkg.version} does not match its exact package pin.`);
        const modules = await realpath(join(app, 'node_modules'));
        if (!(await realpath(path)).startsWith(modules + sep)) throw new Error(`Installed ${name} points outside node_modules. Remove its source link before qualification.`);
    }
    return { name, path, version: pkg.version, mode: development ? 'development-source' as const : 'installed' as const };
}
