import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import {
    CLOUD_SETUP_ARGS,
    LOCAL_MODE_STATE_CONTENTS,
    LOCAL_MODE_STATE_PATH,
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
        expect(path).toBe(join(cwd, LOCAL_MODE_STATE_PATH));
        expect(existsSync(path)).toBe(true);
        const contents = await readFile(path, 'utf8');
        expect(contents).toBe(LOCAL_MODE_STATE_CONTENTS);
        expect(existsSync(join(cwd, '.env'))).toBe(false);
        expect(shouldAskModeChoice(cwd)).toBe(false);
    });

    it('hands cloud setup to the managed local installer', () => {
        expect([...CLOUD_SETUP_ARGS]).toEqual(['init', '--local']);
    });
});
