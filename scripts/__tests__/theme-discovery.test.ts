import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import {
    discoverThemeSourceFiles,
    importThemeSourceModule,
} from '../theme-discovery';

describe('discoverThemeSourceFiles', () => {
    const temporaryDirectories: string[] = [];
    afterEach(async () => {
        await Promise.all(
            temporaryDirectories.splice(0).map((path) =>
                rm(path, { recursive: true, force: true })
            )
        );
    });

    it('discovers both built-in directories and installed theme symlinks', async () => {
        const root = await mkdtemp(join(tmpdir(), 'or3-theme-discovery-'));
        temporaryDirectories.push(root);
        const themesDir = join(root, 'app-theme');
        const installedDir = join(root, 'extensions', 'cyberpunk');
        await mkdir(join(themesDir, 'blank'), { recursive: true });
        await mkdir(installedDir, { recursive: true });
        await writeFile(join(themesDir, 'blank', 'theme.ts'), 'export default {}', 'utf8');
        await writeFile(join(installedDir, 'theme.ts'), 'export default {}', 'utf8');
        await symlink(installedDir, join(themesDir, 'cyberpunk'), 'dir');

        const discovered = await discoverThemeSourceFiles(themesDir);
        expect(discovered.map((path) => basename(join(path, '..')))).toEqual([
            'blank',
            'cyberpunk',
        ]);
    });

    it('imports installed theme source with Nuxt aliases', async () => {
        const root = await mkdtemp(join(tmpdir(), 'or3-theme-import-'));
        temporaryDirectories.push(root);
        const themePath = join(root, 'theme.ts');
        await writeFile(
            themePath,
            `import { defineTheme } from '~/theme/_shared/define-theme';
             export default defineTheme({
                 name: 'installed-test',
                 colors: { primary: '#000', secondary: '#111', surface: '#fff' }
             });`,
            'utf8'
        );

        const module = await importThemeSourceModule<{
            default: { name: string };
        }>(themePath);
        expect(module.default.name).toBe('installed-test');
    });
});
