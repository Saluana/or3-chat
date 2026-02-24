import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';

const APP_THEME_ROOT = resolve(process.cwd(), 'app', 'theme');
const EXTENSION_THEME_MARKER = '.or3-extension-theme';

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

    const markerPath = join(targetDir, EXTENSION_THEME_MARKER);
    let targetExists = false;
    let hasMarker = false;
    try {
        await fs.access(targetDir);
        targetExists = true;
    } catch {
        targetExists = false;
    }

    if (targetExists) {
        try {
            await fs.access(markerPath);
            hasMarker = true;
        } catch {
            hasMarker = false;
        }
    }

    if (targetExists && !hasMarker) {
        throw new Error(
            `Theme id "${themeId}" conflicts with a built-in theme directory. Remove or rename the built-in directory before installing this extension theme.`
        );
    }

    await fs.rm(targetDir, { recursive: true, force: true });
    await fs.mkdir(APP_THEME_ROOT, { recursive: true });
    await fs.cp(sourceDir, targetDir, { recursive: true, force: true });
    await fs.writeFile(join(targetDir, EXTENSION_THEME_MARKER), 'or3-extension-theme\n', 'utf8');
}

export async function removeSyncedThemeFromApp(themeId: string): Promise<void> {
    const targetDir = resolveThemeTargetDir(themeId);
    const markerPath = join(targetDir, EXTENSION_THEME_MARKER);
    try {
        await fs.access(markerPath);
    } catch {
        return;
    }
    await fs.rm(targetDir, { recursive: true, force: true });
}
