/**
 * CLI Commands Test Suite
 *
 * Tests for theme validation, creation, and switching CLI tools
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ThemeCompiler } from '../theme-compiler';
import { existsSync } from 'fs';
import { rm, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';

type CliRunResult = {
    exitCode: number;
    output: string;
};

async function runBunCliScript(
    scriptPath: string,
    args: string[],
    cwd: string
): Promise<CliRunResult> {
    return await new Promise((resolvePromise, rejectPromise) => {
        const child = spawn('bun', [scriptPath, ...args], {
            cwd,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: process.env,
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (chunk) => {
            stdout += String(chunk);
        });
        child.stderr.on('data', (chunk) => {
            stderr += String(chunk);
        });

        child.on('error', (error) => {
            rejectPromise(error);
        });

        child.on('exit', (code) => {
            resolvePromise({
                exitCode: code ?? 1,
                output: `${stdout}${stderr}`,
            });
        });
    });
}

describe('CLI Commands', () => {
    describe('Process-level CLI behavior', () => {
        it('runs or3-cloud help successfully', async () => {
            const result = await runBunCliScript(
                'scripts/cli/or3-cloud.ts',
                ['help'],
                process.cwd()
            );

            expect(result.exitCode).toBe(0);
            expect(result.output).toContain('or3-cloud commands');
            expect(result.output).toContain('or3-cloud init');
        });

        it('runs or3-cloud validate successfully in a temp workspace', async () => {
            const workspaceDir = await mkdtemp(join(tmpdir(), 'or3-cloud-cli-'));

            try {
                await writeFile(join(workspaceDir, '.env'), '', 'utf-8');
                const result = await runBunCliScript(
                    join(process.cwd(), 'scripts/cli/or3-cloud.ts'),
                    ['validate', '--env-file', '.env'],
                    workspaceDir
                );

                expect(result.exitCode).toBe(0);
                expect(result.output).toContain('Validation passed for .env.');
            } finally {
                await rm(workspaceDir, { recursive: true, force: true });
            }
        });

        it('creates a sandbox from an explicit source and writes expected artifacts', async () => {
            const workspaceDir = await mkdtemp(join(tmpdir(), 'or3-sandbox-cli-'));
            const sourceDir = join(workspaceDir, 'template');
            const destDir = join(workspaceDir, 'sandbox-output');

            try {
                await mkdir(join(sourceDir, 'src'), { recursive: true });
                await mkdir(join(sourceDir, 'node_modules', 'left-pad'), {
                    recursive: true,
                });
                await writeFile(
                    join(sourceDir, 'src', 'index.ts'),
                    'export const ok = true;\n',
                    'utf-8'
                );
                await writeFile(
                    join(sourceDir, 'node_modules', 'left-pad', 'index.js'),
                    'module.exports = () => 1;\n',
                    'utf-8'
                );

                const result = await runBunCliScript(
                    join(process.cwd(), 'scripts/cli/create-temp-sandbox.ts'),
                    [
                        '--source',
                        sourceDir,
                        '--dest',
                        destDir,
                        '--no-install',
                    ],
                    process.cwd()
                );

                expect(result.exitCode).toBe(0);
                expect(result.output).toContain('Fresh sandbox created');
                expect(existsSync(join(destDir, 'src', 'index.ts'))).toBe(true);
                expect(
                    existsSync(join(destDir, 'node_modules', 'left-pad', 'index.js'))
                ).toBe(false);
            } finally {
                await rm(workspaceDir, { recursive: true, force: true });
            }
        });
    });

    describe('ThemeCompiler Integration', () => {
        it('should compile all themes without errors', async () => {
            const compiler = new ThemeCompiler();
            const result = await compiler.compileAll();

            expect(result).toBeDefined();
            expect(result.success).toBe(true);
            expect(result.themes.length).toBeGreaterThan(0);
        });

        it('should validate retro theme', async () => {
            const compiler = new ThemeCompiler();
            const result = await compiler.compileAll();

            const retroTheme = result.themes.find((t) => t.name === 'retro');
            expect(retroTheme).toBeDefined();
            expect(retroTheme?.errors.length).toBe(0);
        });

        it('should generate types for all themes', async () => {
            const compiler = new ThemeCompiler();
            await compiler.compileAll();

            const typesPath = join(
                process.cwd(),
                'types',
                'theme-generated.d.ts'
            );
            expect(existsSync(typesPath)).toBe(true);
        });
    });

    describe('Theme Creation Validation', () => {
        const testThemePath = join(process.cwd(), 'app', 'theme', 'test-theme');

        afterEach(async () => {
            // Clean up test theme if it exists
            if (existsSync(testThemePath)) {
                await rm(testThemePath, { recursive: true, force: true });
            }
        });

        it('should validate theme name format', () => {
            const validNames = ['my-theme', 'theme1', 'cool-dark-theme'];
            const invalidNames = [
                'MyTheme',
                'theme_1',
                'Theme-1',
                '1theme',
                'theme!',
            ];

            const validateThemeName = (name: string) =>
                /^[a-z][a-z0-9-]*$/.test(name);

            validNames.forEach((name) => {
                expect(validateThemeName(name)).toBe(true);
            });

            invalidNames.forEach((name) => {
                expect(validateThemeName(name)).toBe(false);
            });
        });

        it('should validate hex color format', () => {
            const validColors = ['#000000', '#ffffff', '#3f8452', '#ABC123'];
            const invalidColors = [
                '#000',
                '#gggggg',
                'rgb(0,0,0)',
                '000000',
                '#12345',
            ];

            const validateColorHex = (color: string) =>
                /^#[0-9A-Fa-f]{6}$/.test(color);

            validColors.forEach((color) => {
                expect(validateColorHex(color)).toBe(true);
            });

            invalidColors.forEach((color) => {
                expect(validateColorHex(color)).toBe(false);
            });
        });
    });

    describe('Theme Discovery', () => {
        it('should discover all theme directories', async () => {
            const compiler = new ThemeCompiler();
            const themes = await compiler['discoverThemes']();

            expect(themes).toBeDefined();
            expect(Array.isArray(themes)).toBe(true);
            expect(themes.length).toBeGreaterThan(0);

            // Should include retro and nature (from example-refined)
            const themeNames = themes
                .map((path) => {
                    const match = path.match(/theme\/([^/]+)\/theme\.ts/);
                    return match ? match[1] : null;
                })
                .filter(Boolean);

            expect(themeNames).toContain('retro');
        });
    });

    describe('Error Handling', () => {
        it('should handle missing theme files gracefully', async () => {
            const compiler = new ThemeCompiler();

            // Try to compile a non-existent theme path
            const result = await compiler['compileTheme'](
                '/nonexistent/theme.ts'
            ).catch((error) => {
                // Should catch and handle error
                return {
                    name: 'error',
                    theme: {},
                    errors: [{ code: 'ERR', message: 'Failed' }],
                    warnings: [],
                };
            });

            // Should either return error result or throw
            expect(result).toBeTruthy();
            if (result && 'errors' in result) {
                expect(result.errors.length).toBeGreaterThan(0);
            }
        });

        it('should report validation errors with helpful messages', async () => {
            const compiler = new ThemeCompiler();
            const result = await compiler.compileAll();

            // Check that error messages have required fields
            result.themes.forEach((theme) => {
                theme.errors.forEach((error) => {
                    expect(error).toHaveProperty('code');
                    expect(error).toHaveProperty('message');
                    expect(error).toHaveProperty('severity');
                    expect(error.message).toBeTruthy();
                });
            });
        });
    });

    describe('Performance', () => {
        it('should compile all themes in under 2 seconds', async () => {
            const compiler = new ThemeCompiler();
            const start = Date.now();

            await compiler.compileAll();

            const duration = Date.now() - start;
            expect(duration).toBeLessThan(2000);
        });
    });
});
