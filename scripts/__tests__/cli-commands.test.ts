/**
 * CLI Commands Test Suite
 *
 * Tests for theme validation, creation, and switching CLI tools
 */

import { describe, it, expect } from 'vitest';
import { ThemeCompiler } from '../theme-compiler';
import { existsSync } from 'fs';
import { readFile, rm, mkdir, mkdtemp, stat, writeFile, symlink } from 'node:fs/promises';
import { join } from 'path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import {
    serializeInitialCredentials,
    writeInitialCredentialsFile,
} from '../cli/or3-cloud';

type CliRunResult = {
    exitCode: number;
    output: string;
};

async function runBunCliScript(
    scriptPath: string,
    args: string[],
    cwd: string,
    env: NodeJS.ProcessEnv = process.env
): Promise<CliRunResult> {
    return await new Promise((resolvePromise, rejectPromise) => {
        const child = spawn('bun', [scriptPath, ...args], {
            cwd,
            stdio: ['ignore', 'pipe', 'pipe'],
            env,
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
                expect(result.output).toContain('Config is valid for .env.');
            } finally {
                await rm(workspaceDir, { recursive: true, force: true });
            }
        });

        it.each([true, false])('runs the full doctor for Basic Auth, SQLite and filesystem storage (sync transfer %s)', async (syncEnabled) => {
            const workspaceDir = await mkdtemp(join(tmpdir(), 'or3-doctor-cli-'));
            try {
                await symlink(join(process.cwd(), 'node_modules'), join(workspaceDir, 'node_modules'), 'dir');
                await mkdir(join(workspaceDir, '.data', 'storage'), { recursive: true });
                await writeFile(join(workspaceDir, '.env'), [
                    'SSR_AUTH_ENABLED=true', 'OR3_AUTH_PROVIDER=basic-auth',
                    'OR3_BASIC_AUTH_JWT_SECRET=doctor-test-secret-0123456789abcdef',
                    'OR3_SYNC_PROVIDER=sqlite', `OR3_SYNC_ENABLED=${syncEnabled}`,
                    'OR3_STORAGE_ENABLED=true', 'NUXT_PUBLIC_STORAGE_PROVIDER=fs',
                    'OR3_STORAGE_FS_ROOT=.data/storage',
                ].join('\n'));
                const result = await runBunCliScript(
                    join(process.cwd(), 'scripts/cli/or3-cloud.ts'), ['doctor'], workspaceDir,
                    { ...process.env, OR3_STRICT_CONFIG: 'false', NODE_ENV: 'development' },
                );
                expect(result.exitCode, result.output).toBe(0);
                expect(result.output).toContain('SQLite sync DB path accessible');
                expect(result.output).toContain('Basic-auth DB path accessible');
                expect(result.output).toContain('FS storage root directory accessible');
                expect(result.output).toContain('Doctor: all checks passed');
            } finally {
                await rm(workspaceDir, { recursive: true, force: true });
            }
        });

        it('checks the port from the selected environment file and skips inactive provider paths', async () => {
            const workspaceDir = await mkdtemp(join(tmpdir(), 'or3-doctor-port-'));
            const server = createServer();
            try {
                const port = await new Promise<number>((resolvePort, reject) => {
                    server.once('error', reject);
                    server.listen(0, '127.0.0.1', () => {
                        resolvePort((server.address() as { port: number }).port);
                    });
                });
                await writeFile(join(workspaceDir, '.env.local'), [
                    'SSR_AUTH_ENABLED=false', 'OR3_AUTH_PROVIDER=basic-auth',
                    `PORT=${port}`,
                ].join('\n'));
                const result = await runBunCliScript(
                    join(process.cwd(), 'scripts/cli/or3-cloud.ts'),
                    ['doctor', '--env-file', '.env.local'], workspaceDir,
                    { ...process.env, PORT: '9', NODE_ENV: 'development', OR3_STRICT_CONFIG: 'false' },
                );
                expect(result.exitCode, result.output).toBe(0);
                expect(result.output).toContain(`Port ${port} is already in use`);
                expect(result.output).not.toMatch(/(?:Basic-auth|SQLite sync) DB path/);
            } finally {
                await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
                await rm(workspaceDir, { recursive: true, force: true });
            }
        });

        it('stores generated first-run credentials in a private file', async () => {
            const workspaceDir = await mkdtemp(join(tmpdir(), 'or3-credentials-'));

            try {
                const path = await writeInitialCredentialsFile(workspaceDir, {
                    bootstrapEmail: 'admin@example.com',
                    bootstrapPassword: 'GeneratedPassword123',
                    adminUsername: 'admin@example.com',
                    adminPassword: 'GeneratedPassword123',
                });

                expect(path).toBe(join(workspaceDir, '.or3-initial-credentials'));
                expect(await readFile(path!, 'utf8')).toContain(
                    'OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD=GeneratedPassword123'
                );
                expect((await stat(path!)).mode & 0o777).toBe(0o600);
            } finally {
                await rm(workspaceDir, { recursive: true, force: true });
            }
        });

        it('uses the documented KEY=value initial-credentials format', () => {
            expect(
                serializeInitialCredentials({
                    bootstrapEmail: 'admin@example.com',
                    bootstrapPassword: 'GeneratedPassword123',
                    adminUsername: 'admin@example.com',
                    adminPassword: 'GeneratedPassword123',
                })
            ).toBe(
                '# OR3 first-run credentials — move to a password manager, then delete this file.\n' +
                    'OR3_BASIC_AUTH_BOOTSTRAP_EMAIL=admin@example.com\n' +
                    'OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD=GeneratedPassword123\n' +
                    'OR3_ADMIN_USERNAME=admin@example.com\n' +
                    'OR3_ADMIN_PASSWORD=GeneratedPassword123\n'
            );
        });

        it('quotes unsafe credential values and rejects line injection', () => {
            expect(
                serializeInitialCredentials({
                    bootstrapPassword: "A$word with \\slashes and 'quotes' 123",
                })
            ).toContain(
                "OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD='A$word with \\\\slashes and \\'quotes\\' 123'"
            );
            expect(() =>
                serializeInitialCredentials({
                    adminPassword: 'AValidPassword123\nOR3_ADMIN_PASSWORD=injected',
                })
            ).toThrow('newline');
        });

        it('keeps fast-setup passwords out of terminal output', async () => {
            const workspaceDir = await mkdtemp(join(tmpdir(), 'or3-fast-cli-'));
            const wizardHome = join(workspaceDir, 'wizard-home');

            try {
                const result = await runBunCliScript(
                    join(process.cwd(), 'scripts/cli/or3-cloud.ts'),
                    [
                        'init',
                        '--fast',
                        '--mode',
                        'self-hosted',
                        '--target',
                        'configure',
                        '--cli',
                        '--instance-dir',
                        workspaceDir,
                        '--admin-email',
                        'admin@example.com',
                    ],
                    workspaceDir,
                    { ...process.env, OR3_CLOUD_WIZARD_HOME: wizardHome }
                );

                expect(result.exitCode).toBe(0);
                expect(result.output).toContain('First-run credentials were written');
                expect(result.output).not.toContain('Bootstrap password:');
                expect(result.output).not.toContain('Admin dashboard password:');
                const credentialsPath = join(
                    workspaceDir,
                    '.or3-initial-credentials'
                );
                expect((await stat(credentialsPath)).mode & 0o777).toBe(0o600);
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
        it('compiles and validates all themes without writing tracked output', async () => {
            const outputRoot = await mkdtemp(join(tmpdir(), 'or3-themes-'));

            try {
                const result = await new ThemeCompiler(outputRoot).compileAll();
                const retroTheme = result.themes.find(
                    (theme) => theme.name === 'retro'
                );

                expect(result.success).toBe(true);
                expect(result.themes.length).toBeGreaterThan(0);
                expect(retroTheme?.errors).toEqual([]);
                expect(
                    existsSync(join(outputRoot, 'types/theme-generated.d.ts'))
                ).toBe(true);
                expect(
                    existsSync(
                        join(
                            outputRoot,
                            'app/theme/_shared/theme-manifest.generated.ts'
                        )
                    )
                ).toBe(true);
            } finally {
                await rm(outputRoot, { recursive: true, force: true });
            }
        });
    });

    describe('Theme Discovery', () => {
        it('should discover all theme directories', async () => {
            const compiler = new ThemeCompiler();
            const themes = await compiler['discoverThemes']();

            expect(themes.length).toBeGreaterThan(0);

            // Should include retro and nature (from example-refined)
            const themeNames = themes
                .map((path) => {
                    const match = path.match(/theme\/([^/]+)\/theme\.ts/);
                    return match ? match[1] : null;
                })
                .filter(Boolean);

            expect(themeNames).toContain('retro');
            // Symlinked extension themes (e.g. cyberpunk) must be discoverable too.
            expect(themeNames).toContain('cyberpunk');
        });
    });

});
