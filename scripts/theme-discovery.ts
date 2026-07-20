import { access, readdir, stat } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Discover theme entry files, including installed themes exposed by symlink. */
export async function discoverThemeSourceFiles(
    themeDir = join(process.cwd(), 'app', 'theme')
): Promise<string[]> {
    const entries = await readdir(themeDir, { withFileTypes: true });
    const themePaths: string[] = [];

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.name.startsWith('_')) continue;

        let isThemeDirectory = entry.isDirectory();
        if (!isThemeDirectory && entry.isSymbolicLink()) {
            try {
                isThemeDirectory = (await stat(join(themeDir, entry.name))).isDirectory();
            } catch {
                isThemeDirectory = false;
            }
        }
        if (!isThemeDirectory) continue;

        const themePath = join(themeDir, entry.name, 'theme.ts');
        try {
            await access(themePath, fsConstants.F_OK);
            themePaths.push(themePath);
        } catch {
            if (process.env.NODE_ENV !== 'test') {
                console.warn(
                    `[theme-discovery] Skipping "${entry.name}" (no theme.ts)`
                );
            }
        }
    }

    return themePaths;
}

/** Import theme source with the same Nuxt aliases in every CLI/build path. */
export async function importThemeSourceModule<T = unknown>(
    modulePath: string
): Promise<T> {
    const { createJiti } = await import('jiti');
    const root = process.cwd();
    const jiti = createJiti(import.meta.url, {
        interopDefault: true,
        alias: {
            '~': join(root, 'app'),
            '~~': root,
            '@': join(root, 'app'),
        },
    });
    return (await jiti.import(pathToFileURL(modulePath).href)) as T;
}
