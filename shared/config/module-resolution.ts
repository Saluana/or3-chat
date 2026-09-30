import { statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveModulePath } from 'exsolve';

export type ModuleResolution =
    | { ok: true; entry: string }
    | { ok: false; message: string };

/** Package identity only; local paths and unsupported identifiers have no package. */
export function modulePackageName(moduleId: string): string | null {
    const id = moduleId.trim();
    if (!/^(?:@[\w.-]+\/)?[\w.-]+(?:\/[\w.-]+)*$/.test(id)) return null;
    if (id.split('/').some((part) => part === '.' || part === '..'))
        return null;
    return id.startsWith('@')
        ? id.split('/').slice(0, 2).join('/')
        : id.split('/')[0]!;
}

/** Resolve the same import entry Nuxt will load, without evaluating the module. */
export function resolveModuleEntry(
    moduleId: string,
    rootDir: string,
): ModuleResolution {
    const id = moduleId.trim();
    const local = isAbsolute(id) || id.startsWith('./') || id.startsWith('../');
    if (
        !id ||
        /[\x00-\x1f\x7f]/.test(id) ||
        (!local && !modulePackageName(id))
    ) {
        return {
            ok: false,
            message:
                'Invalid module identifier; use a package import or an explicit local file path.',
        };
    }
    try {
        const entry = resolveModulePath(local ? resolve(rootDir, id) : id, {
            from: pathToFileURL(resolve(rootDir) + '/'),
            conditions: ['node', 'import'],
            suffixes: [
                'nuxt',
                'nuxt/index',
                'module',
                'module/index',
                '',
                'index',
            ],
            extensions: ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts'],
            // Configuration is resolved once; do not retain stale filesystem results in dev/doctor.
            cache: false,
        });
        if (!statSync(entry).isFile()) {
            return {
                ok: false,
                message: 'The selected module entry is not a file.',
            };
        }
        return { ok: true, entry };
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        return {
            ok: false,
            message:
                code === 'ERR_PACKAGE_PATH_NOT_EXPORTED'
                    ? 'The package does not export the requested module entry.'
                    : code === 'EACCES' || code === 'EPERM'
                      ? 'The module entry cannot be read; check filesystem permissions.'
                      : 'The requested module entry cannot be resolved to an existing file.',
        };
    }
}
