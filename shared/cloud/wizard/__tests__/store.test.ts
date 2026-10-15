import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { saveSession, saveStoredPreset, listStoredPresets } from '../store';
import type { WizardSession } from '../types';

// Filesystem boundary: permissive umask, simultaneous writers and failed replace
// must not disclose secrets, lose presets, or truncate the previous session.
const renameMock = vi.hoisted(() => vi.fn());
vi.mock('node:fs/promises', async importOriginal => {
    const actual = await importOriginal<typeof import('node:fs/promises')>();
    return { ...actual, rename: (...args: Parameters<typeof actual.rename>) => renameMock(...args) ?? actual.rename(...args) };
});
describe('wizard persistence', () => {
    let home: string;
    const session: WizardSession = { id: 'synthetic', createdAt: '', updatedAt: '', currentStepId: 'target', answers: { adminPassword: 'SyntheticSecret123' }, metadata: { includeSecrets: true } };
    beforeEach(async () => { home = await mkdtemp(`${tmpdir()}/or3-store-`); vi.stubEnv('OR3_CLOUD_WIZARD_HOME', home); renameMock.mockReset(); });
    afterEach(async () => { vi.unstubAllEnvs(); await rm(home, { recursive: true, force: true }); });
    it('keeps secret session files and directories private', async () => {
        await saveSession(session);
        expect((await stat(`${home}/.or3-cloud/sessions/synthetic.json`)).mode & 0o777).toBe(0o600);
        expect((await stat(`${home}/.or3-cloud/sessions`)).mode & 0o777).toBe(0o700);
    });
    it('retains every distinct preset under concurrent saves', async () => {
        await Promise.all(Array.from({ length: 15 }, (_, n) => saveStoredPreset({ name: `preset-${n}`, createdAt: '', answers: {} })));
        expect(await listStoredPresets()).toHaveLength(15);
    });
    it('keeps the previous file if replacement fails', async () => {
        await saveSession(session);
        renameMock.mockRejectedValueOnce(new Error('simulated rename failure'));
        await expect(saveSession({ ...session, currentStepId: 'new' })).rejects.toThrow('simulated rename failure');
        expect(JSON.parse(await readFile(`${home}/.or3-cloud/sessions/synthetic.json`, 'utf8')).currentStepId).toBe('target');
    });
});
