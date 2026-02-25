import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';

const APP_THEME_ROOT = resolve(process.cwd(), 'app', 'theme');
const EXTENSION_THEME_MARKER = '.or3-extension-theme';

async function pathExists(path: string): Promise<boolean> {
    try {
        await fs.access(path);
        return true;
    } catch {
        return false;
    }
}

async function isManagedTarget(
    targetDir: string,
    sourceDir: string
): Promise<boolean> {
    const markerPath = join(targetDir, EXTENSION_THEME_MARKER);
    if (await pathExists(markerPath)) {
        return true;
    }

    try {
        const stat = await fs.lstat(targetDir);
        if (!stat.isSymbolicLink()) {
            return false;
        }

        const linkValue = await fs.readlink(targetDir);
        const resolvedLink = resolve(targetDir, '..', linkValue);
        return resolvedLink === resolve(sourceDir);
    } catch {
        return false;
    }
}

function resolveThemeTargetDir(themeId: string): string {
    if (!themeId || themeId.includes('..') || themeId.includes('/') || themeId.includes('\\')) {
        throw new Error('Invalid theme id');
    }
    return join(APP_THEME_ROOT, themeId);
}

export async function syncInstalledThemeToApp(
    themeId: string,
    sourceDir: string
): Promise<void> {
    const targetDir = resolveThemeTargetDir(themeId);

    const targetExists = await pathExists(targetDir);
    const managedTarget = targetExists
        ? await isManagedTarget(targetDir, sourceDir)
        : false;

    if (targetExists && !managedTarget) {
        throw new Error(
            `Theme id "${themeId}" conflicts with a built-in theme directory. Remove or rename the built-in directory before installing this extension theme.`
        );
    }

    await fs.rm(targetDir, { recursive: true, force: true });
    await fs.mkdir(APP_THEME_ROOT, { recursive: true });

    try {
        await fs.symlink(
            sourceDir,
            targetDir,
            process.platform === 'win32' ? 'junction' : 'dir'
        );
        return;
    } catch {
        // Fallback for environments where symlink creation is not permitted.
    }

    await fs.cp(sourceDir, targetDir, { recursive: true, force: true });
    await fs.writeFile(
        join(targetDir, EXTENSION_THEME_MARKER),
        'or3-extension-theme\n',
        'utf8'
    );
}

export async function removeSyncedThemeFromApp(themeId: string): Promise<void> {
    const targetDir = resolveThemeTargetDir(themeId);
    const sourceDir = resolve(process.cwd(), 'extensions', 'themes', themeId);
    const managedTarget = await isManagedTarget(targetDir, sourceDir);
    if (!managedTarget) {
        return;
    }
    await fs.rm(targetDir, { recursive: true, force: true });
}
