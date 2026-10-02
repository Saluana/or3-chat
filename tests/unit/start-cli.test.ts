import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import {
    CLOUD_SETUP_ARGS,
    shouldAskModeChoice,
    writeLocalModeMarker,
} from '../../scripts/cli/start.mjs';

describe('bun start mode choice', () => {
    let cwd: string;

    beforeEach(async () => {
        cwd = await mkdtemp(join(tmpdir(), 'or3-start-'));
    });

    afterEach(async () => {
        await rm(cwd, { recursive: true, force: true });
    });

    it('asks on a fresh clone with no env files', () => {
        expect(shouldAskModeChoice(cwd)).toBe(true);
    });

    it('does not ask when .env already exists', async () => {
        await writeFile(join(cwd, '.env'), 'SSR_AUTH_ENABLED=false\n', 'utf8');
        expect(shouldAskModeChoice(cwd)).toBe(false);
    });

    it('does not ask when .env.local already exists', async () => {
        await writeFile(join(cwd, '.env.local'), 'SSR_AUTH_ENABLED=true\n', 'utf8');
        expect(shouldAskModeChoice(cwd)).toBe(false);
    });

    it('writes a local-mode state marker without creating an environment file', async () => {
        const path = writeLocalModeMarker(cwd);
        expect(path).toBe(join(cwd, '.or3/setup.json'));
        expect(existsSync(path)).toBe(true);
        const contents = await readFile(path, 'utf8');
        expect(JSON.parse(contents)).toEqual({ version: 1, mode: 'local' });
        expect(existsSync(join(cwd, '.env'))).toBe(false);
        expect(shouldAskModeChoice(cwd)).toBe(false);
    });

    it('hands cloud setup to the managed local installer', () => {
        expect([...CLOUD_SETUP_ARGS]).toEqual(['init', '--local']);
    });

    it('returns failure when the launched development process is terminated', async () => {
        const bin = join(cwd, 'bin');
        await mkdir(bin);
        await mkdir(join(cwd, 'node_modules'));
        await writeFile(join(cwd, '.env'), '');
        await symlink(process.execPath, join(bin, 'node'));
        await writeFile(join(bin, 'bun'), '#!/usr/bin/env node\nprocess.kill(process.pid, "SIGTERM");\n', { mode: 0o755 });
        const result = spawnSync(process.execPath, [resolve('scripts/cli/start.mjs')], {
            cwd, encoding: 'utf8', timeout: 10_000,
            env: { PATH: bin, CI: 'true', npm_config_user_agent: 'bun/1.3.14' },
        });
        expect(result.status).toBe(1);
    });
});
