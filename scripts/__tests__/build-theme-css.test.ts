import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildThemeCSS, buildThemeCSSFiles } from '../build-theme-css';
import type { ThemeDefinition } from '../../app/theme/_shared/types';

describe('buildThemeCSS', () => {
    const temporaryDirectories: string[] = [];
    afterEach(async () => {
        await Promise.all(
            temporaryDirectories.splice(0).map((path) =>
                rm(path, { recursive: true, force: true })
            )
        );
    });
    it('scopes every branch of a comma-separated selector list', () => {
        const theme = {
            name: 'retro',
            colors: { primary: '#000', secondary: '#111', surface: '#fff' },
            cssSelectors: {
                '#one, #two:is(.active, .focused)': {
                    style: { backgroundColor: 'red' },
                },
            },
        } satisfies ThemeDefinition;

        const css = buildThemeCSS(theme);
        expect(css).toContain('[data-theme="retro"] #one,');
        expect(css).toContain(
            '[data-theme="retro"] #two:is(.active, .focused)'
        );
        expect(css).not.toMatch(/\n#two/);
    });

    it('removes stale generated CSS while preserving current output', async () => {
        const outputDir = await mkdtemp(join(tmpdir(), 'or3-theme-css-'));
        temporaryDirectories.push(outputDir);
        await writeFile(join(outputDir, 'removed-theme.css'), 'stale', 'utf8');
        const theme = {
            name: 'current-theme',
            colors: { primary: '#000', secondary: '#111', surface: '#fff' },
            cssSelectors: {
                '.current': { style: { color: 'red' } },
            },
        } satisfies ThemeDefinition;

        await buildThemeCSSFiles([theme], outputDir);
        await expect(readFile(join(outputDir, 'removed-theme.css'), 'utf8')).rejects.toThrow();
        await expect(readFile(join(outputDir, 'current-theme.css'), 'utf8')).resolves.toContain(
            '[data-theme="current-theme"] .current'
        );
    });
});
