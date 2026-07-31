import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import {
    CLOUD_SETUP_ARGS,
    LOCAL_MODE_ENV_CONTENTS,
    shouldAskModeChoice,
    writeLocalModeMarker,
} from '../../scripts/cli/start';

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

    it('writes a local-mode .env marker so the next start skips the prompt', async () => {
        const path = writeLocalModeMarker(cwd);
        expect(path).toBe(join(cwd, '.env'));
        expect(existsSync(path)).toBe(true);
        const contents = await readFile(path, 'utf8');
        expect(contents).toBe(LOCAL_MODE_ENV_CONTENTS);
        expect(contents).toContain('SSR_AUTH_ENABLED=false');
        expect(shouldAskModeChoice(cwd)).toBe(false);
    });

    it('hands cloud setup the self-hosted mode flag', () => {
        expect([...CLOUD_SETUP_ARGS]).toEqual(['--mode', 'self-hosted']);
    });
});
