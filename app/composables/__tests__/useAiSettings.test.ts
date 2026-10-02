import { describe, it, expect, beforeEach, vi } from 'vitest';

import { getDb, setActiveWorkspaceDb, evictWorkspaceDb, Or3DB } from '~/db/client';
import { getKvByName, setKvByName } from '~/db/kv';
import { useHooks, setHookEngine } from '~/core/hooks/useHooks';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import Dexie from 'dexie';
import { afterEach } from 'vitest';

let workspace: string;
let dispose: (() => void) | undefined;

import {
    DEFAULT_AI_SETTINGS,
    sanitizeAiSettings,
    useAiSettings,
    type AiSettingsV1,
} from '../chat/useAiSettings';

describe('useAiSettings', () => {
    beforeEach(async () => {
        workspace = `settings-${crypto.randomUUID()}`;
        setHookEngine(createTypedHookEngine(createHookEngine()));
        await setActiveWorkspaceDb(workspace).open();
        vi.clearAllMocks();
    });

    afterEach(async () => {
        dispose?.(); dispose = undefined;
        const name = getDb().name;
        setActiveWorkspaceDb(null);
        evictWorkspaceDb(workspace);
        await Dexie.delete(name);
        setHookEngine(null);
    });

    it('sanitizes invalid input and fills defaults (minimal schema)', () => {
        const dirty: any = {
            version: 999,
            masterSystemPrompt: 123,
            defaultModelMode: 'weird',
            fixedModelId: 42,
        };
        const s = sanitizeAiSettings(dirty);
        expect(s.version).toBe(1);
        expect(typeof s.masterSystemPrompt).toBe('string');
        expect(s.defaultModelMode).toBe('lastSelected');
        expect(s.fixedModelId).toBeNull();
    });

    it('migrates missing keys to defaults', () => {
        const partial = { masterSystemPrompt: 'x' } as Partial<AiSettingsV1>;
        const s = sanitizeAiSettings(partial);
        for (const k of Object.keys(DEFAULT_AI_SETTINGS) as Array<
            keyof AiSettingsV1
        >) {
            expect(s[k]).not.toBeUndefined();
        }
    });

    it('persists and loads settings', async () => {
        const { set, load, settings, ensureLoaded } = useAiSettings();
        await ensureLoaded();
        await set({
            masterSystemPrompt: 'hello',
            defaultModelMode: 'fixed',
            fixedModelId: 'm1',
        });
        const loaded = load();
        expect(loaded.masterSystemPrompt).toBe('hello');
        expect(loaded.defaultModelMode).toBe('fixed');
        expect(loaded.fixedModelId).toBe('m1');
        // Also verify via the reactive settings
        expect(settings.value.masterSystemPrompt).toBe('hello');
    });

    it('handles missing KV gracefully', async () => {
        const { load, ensureLoaded } = useAiSettings();
        await ensureLoaded();
        const after = load();
        // Should return defaults, not throw
        expect(after.version).toBe(1);
    });
    it('keeps the context maximum optional and preserves valid large preferences through KV/reset', async () => {
        const api = useAiSettings();
        await api.ensureLoaded();
        expect(api.load()).toMatchObject({ maxContextTokens: null });
        await api.set({ maxContextTokens: 2_000_000 });
        expect(JSON.parse((await getKvByName('ai_settings'))!.value!)).toMatchObject({ maxContextTokens: 2_000_000 });
        for (const invalid of [0, -1, 1.5, Infinity, NaN]) {
            await expect(api.set({ maxContextTokens: invalid })).rejects.toThrow(/positive.*integer/i);
            expect(api.load()).toMatchObject({ maxContextTokens: 2_000_000 });
        }
        await api.reset();
        expect(JSON.parse((await getKvByName('ai_settings'))!.value!)).toMatchObject({ maxContextTokens: null });
        expect(sanitizeAiSettings({ version: 1 })).toMatchObject({ maxContextTokens: null });
    });

    it('rejects a stale preference write when workspace changes during its load', async () => {
        const dbA = getDb();
        await setKvByName('ai_settings', JSON.stringify({ ...DEFAULT_AI_SETTINGS, masterSystemPrompt: 'A', maxContextTokens: 1_000_000 }), dbA);
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        let entered!: () => void;
        const pending = new Promise<void>((resolve) => { entered = resolve; });
        const hooks = useHooks();
        const hold: Parameters<typeof hooks.addFilter<'db.kv.getByName:filter:output'>>[1] = async (row) => {
            if (row?.value?.includes('"masterSystemPrompt":"A"')) { entered(); await gate; }
            return row;
        };
        hooks.addFilter('db.kv.getByName:filter:output', hold);
        dispose = () => hooks.removeFilter('db.kv.getByName:filter:output', hold);
        const api = useAiSettings();
        const staleSet = api.set({ masterSystemPrompt: 'Must stay in A' });
        const staleOutcome = staleSet.then(() => null, (error: unknown) => error);
        await pending;
        const otherId = `settings-other-${crypto.randomUUID()}`;
        const dbB = setActiveWorkspaceDb(otherId);
        try {
            await setKvByName('ai_settings', JSON.stringify({ ...DEFAULT_AI_SETTINGS, masterSystemPrompt: 'B', maxContextTokens: 64_000 }), dbB);
            await api.ensureLoaded();
            release();
            expect(await staleOutcome).toBeInstanceOf(Error);
            expect(api.load()).toMatchObject({ masterSystemPrompt: 'B', maxContextTokens: 64_000 });
            expect(JSON.parse((await getKvByName('ai_settings', dbB))!.value!)).toMatchObject({ masterSystemPrompt: 'B' });
            dispose?.(); dispose = undefined;
            expect(JSON.parse((await getKvByName('ai_settings', dbA))!.value!)).toMatchObject({ masterSystemPrompt: 'A' });
        } finally { release(); setActiveWorkspaceDb(workspace); evictWorkspaceDb(otherId); await Dexie.delete(dbB.name); }
    });

    it('keeps different-field concurrent saves and resumes the queue after a failed save', async () => {
        const api = useAiSettings();
        await api.ensureLoaded();
        await api.set({ masterSystemPrompt: 'initial', maxContextTokens: 100_000 });
        const hooks = useHooks();
        let entered!: () => void; let release!: () => void;
        const pending = new Promise<void>((resolve) => { entered = resolve; });
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const hold: Parameters<typeof hooks.addFilter<'db.kv.upsertByName:filter:input'>>[1] = async (row) => {
            if (row.value?.includes('"masterSystemPrompt":"first"')) { entered(); await gate; }
            return row;
        };
        hooks.addFilter('db.kv.upsertByName:filter:input', hold);
        dispose = () => hooks.removeFilter('db.kv.upsertByName:filter:input', hold);
        const first = api.set({ masterSystemPrompt: 'first' });
        await pending;
        const second = api.set({ maxContextTokens: 2_000_000 });
        release();
        await Promise.all([first, second]);
        expect(api.load()).toMatchObject({ masterSystemPrompt: 'first', maxContextTokens: 2_000_000 });
        expect(JSON.parse((await getKvByName('ai_settings'))!.value!)).toMatchObject({ masterSystemPrompt: 'first', maxContextTokens: 2_000_000 });
        dispose(); dispose = undefined;
        const failedPut = vi.spyOn(getDb().kv, 'put').mockImplementationOnce(() => {
            throw new Error('Injected preference save failure');
        });
        const failed = api.set({ masterSystemPrompt: 'failed' }).then(() => null, (error: unknown) => error);
        const following = api.set({ defaultModelVariant: 'nitro' });
        const [failure] = await Promise.all([failed, following]);
        failedPut.mockRestore();
        expect(failure).toBeInstanceOf(Error);
        expect(api.load()).toMatchObject({ masterSystemPrompt: 'first', defaultModelVariant: 'nitro', maxContextTokens: 2_000_000 });
        expect(JSON.parse((await getKvByName('ai_settings'))!.value!)).toMatchObject({ masterSystemPrompt: 'first', defaultModelVariant: 'nitro' });
    });

    it.each(['set', 'reset'] as const)('rejects an old %s after A→B→A while preserving a newer A preference', async (mode) => {
        const api = useAiSettings();
        await api.ensureLoaded();
        await api.set({ masterSystemPrompt: 'initial A', maxContextTokens: 1_000_000 });
        const dbA = getDb();
        let entered!: () => void; let release!: () => void; let held = false;
        const pending = new Promise<void>((resolve) => { entered = resolve; });
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const hooks = useHooks();
        const hold: Parameters<typeof hooks.addFilter<'db.kv.upsertByName:filter:input'>>[1] = async (row) => {
            if (!held) { held = true; entered(); await gate; }
            return row;
        };
        hooks.addFilter('db.kv.upsertByName:filter:input', hold);
        dispose = () => hooks.removeFilter('db.kv.upsertByName:filter:input', hold);
        const stale = (mode === 'set' ? api.set({ masterSystemPrompt: 'stale A' }) : api.reset())
            .then(() => null, (error: unknown) => error);
        await pending;
        const otherId = `settings-other-${crypto.randomUUID()}`;
        const dbB = setActiveWorkspaceDb(otherId);
        try {
            await api.ensureLoaded();
            await api.set({ masterSystemPrompt: 'B', maxContextTokens: 64_000 });
            expect(setActiveWorkspaceDb(workspace)).toBe(dbA);
            await api.ensureLoaded();
            await api.set({ masterSystemPrompt: 'new A', maxContextTokens: 2_000_000 });
            release();
            expect(await stale).toBeInstanceOf(Error);
            expect(api.load()).toMatchObject({ masterSystemPrompt: 'new A', maxContextTokens: 2_000_000 });
            expect(JSON.parse((await getKvByName('ai_settings', dbA))!.value!)).toMatchObject({ masterSystemPrompt: 'new A', maxContextTokens: 2_000_000 });
            expect(JSON.parse((await getKvByName('ai_settings', dbB))!.value!)).toMatchObject({ masterSystemPrompt: 'B', maxContextTokens: 64_000 });
        } finally { release(); setActiveWorkspaceDb(workspace); evictWorkspaceDb(otherId); await Dexie.delete(dbB.name); }
    });

    it('refuses to overwrite a separate handle preference changed while its save hook was delayed', async () => {
        const api = useAiSettings();
        await api.ensureLoaded();
        await api.set({ masterSystemPrompt: 'initial', maxContextTokens: 100_000 });
        const externalDb = new Or3DB(getDb().name);
        await externalDb.open();
        let entered!: () => void; let release!: () => void;
        const pending = new Promise<void>((resolve) => { entered = resolve; });
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const hooks = useHooks();
        const hold: Parameters<typeof hooks.addFilter<'db.kv.upsertByName:filter:input'>>[1] = async (row) => {
            if (row.value?.includes('"masterSystemPrompt":"delayed"')) { entered(); await gate; }
            return row;
        };
        hooks.addFilter('db.kv.upsertByName:filter:input', hold);
        dispose = () => hooks.removeFilter('db.kv.upsertByName:filter:input', hold);
        const delayed = api.set({ masterSystemPrompt: 'delayed' }).then(() => null, (error: unknown) => error);
        try {
            await pending;
            await setKvByName('ai_settings', JSON.stringify({ ...DEFAULT_AI_SETTINGS, masterSystemPrompt: 'other tab', maxContextTokens: 2_000_000 }), externalDb);
            release();
            expect(await delayed).toBeInstanceOf(Error);
            expect(JSON.parse((await getKvByName('ai_settings', externalDb))!.value!)).toMatchObject({ masterSystemPrompt: 'other tab', maxContextTokens: 2_000_000 });
            await api.set({ defaultModelVariant: 'nitro' });
            expect(api.load()).toMatchObject({ masterSystemPrompt: 'other tab', maxContextTokens: 2_000_000, defaultModelVariant: 'nitro' });
        } finally { release(); externalDb.close(); }
    });

});
