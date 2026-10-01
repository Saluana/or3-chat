import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { discoverThemeSourceFiles } from '../theme-discovery';

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

    it.each(['node', 'bun'])('imports installed theme source with Nuxt aliases under %s', async (runtime) => {
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

        const importer = join(process.cwd(), 'scripts/theme-discovery.ts');
        const probe = join(root, 'probe.mts');
        await writeFile(probe, `
            import { importThemeSourceModule } from ${JSON.stringify(importer)};
            const theme = await importThemeSourceModule(${JSON.stringify(themePath)});
            console.log(JSON.stringify({ name: theme.default.name }));
        `);
        const args = runtime === 'bun'
            ? [probe]
            : ['--import', import.meta.resolve('tsx'), probe];
        const stdout = execFileSync(runtime === 'bun' ? 'bun' : process.execPath, args, {
            cwd: process.cwd(), encoding: 'utf8', timeout: 15_000,
            env: { ...process.env, JITI_FS_CACHE: 'false', JITI_MODULE_CACHE: 'false' },
            maxBuffer: 64 * 1024,
        });
        expect(JSON.parse(stdout)).toEqual({ name: 'installed-test' });
    });
});
