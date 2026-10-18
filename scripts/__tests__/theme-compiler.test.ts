/**
 * Unit tests for ThemeCompiler
 * Tests generated tooling artifacts; shared compilation is covered at its owner.
 */

import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ThemeCompiler } from '../theme-compiler';
describe('ThemeCompiler', () => {
    describe('type generation', () => {
        it('generates theme and identifier unions in an isolated directory', async () => {
            const outputRoot = await mkdtemp(
                join(tmpdir(), 'or3-theme-compiler-')
            );
            const isolatedCompiler = new ThemeCompiler(outputRoot);
            const results = [
                {
                    name: 'theme1',
                    theme: {
                        name: 'theme1',
                        overrides: [
                            {
                                identifier: 'chat.send',
                                component: 'button',
                            },
                        ],
                    } as any,
                    errors: [],
                    warnings: [],
                    success: true,
                },
                {
                    name: 'theme2',
                    theme: { name: 'theme2', overrides: [] } as any,
                    errors: [],
                    warnings: [],
                    success: true,
                },
            ];

            try {
                await (isolatedCompiler as any).generateTypes(results);
                const generated = await readFile(
                    join(outputRoot, 'types/theme-generated.d.ts'),
                    'utf8'
                );

                expect(generated).toContain(
                    "export type ThemeName = 'theme1' | 'theme2'"
                );
                expect(generated).toContain(
                    "export type ThemeIdentifier = 'chat.send'"
                );
            } finally {
                await rm(outputRoot, { recursive: true, force: true });
            }
        });
    });

    describe('metadata generation', () => {
        it('keeps the source directory separate from the public theme name', async () => {
            const outputRoot = await mkdtemp(
                join(tmpdir(), 'or3-theme-metadata-')
            );
            const isolatedCompiler = new ThemeCompiler(outputRoot);
            const results = [
                {
                    name: 'public-theme-name',
                    dirName: 'installed-theme-directory',
                    theme: {
                        name: 'public-theme-name',
                        displayName: 'Public Theme',
                        overrides: [],
                    } as any,
                    errors: [],
                    warnings: [],
                    success: true,
                },
            ];

            try {
                await (isolatedCompiler as any).generateMetadataManifest(results);
                const generated = await readFile(
                    join(
                        outputRoot,
                        'app/theme/_shared/theme-manifest.generated.ts'
                    ),
                    'utf8'
                );

                expect(generated).toContain('"name": "public-theme-name"');
                expect(generated).toContain(
                    '"dirName": "installed-theme-directory"'
                );
            } finally {
                await rm(outputRoot, { recursive: true, force: true });
            }
        });
    });
});
