import { describe, expect, it, vi } from 'vitest';
import {
    getOrCreateClientHookEngine,
    type ClientHookEngineGlobal,
} from '../runtime-kernel';

describe('Hook Runtime V2 startup rollback', () => {
    it('keeps the first V1 selection authoritative until a restart', async () => {
        const global: ClientHookEngineGlobal = {};
        const selected = getOrCreateClientHookEngine(global, 'v1');
        const callback = vi.fn();
        selected.addAction('rollback.action', callback);

        const liveMutationAttempt = getOrCreateClientHookEngine(global, 'v2');
        await liveMutationAttempt.doAction('rollback.action');

        expect(liveMutationAttempt).toBe(selected);
        expect(global.__NUXT_HOOKS_VERSION__).toBe('v1');
        expect('_runtimeV2' in selected).toBe(false);
        expect(callback).toHaveBeenCalledTimes(1);
    });

    it('keeps the first V2 selection authoritative until flag-off plus restart', async () => {
        const global: ClientHookEngineGlobal = {};
        const selected = getOrCreateClientHookEngine(global, 'v2');
        const callback = vi.fn();
        selected.addAction('rollback.action', callback);

        const liveMutationAttempt = getOrCreateClientHookEngine(global, 'v1');
        await liveMutationAttempt.doAction('rollback.action');

        expect(liveMutationAttempt).toBe(selected);
        expect(global.__NUXT_HOOKS_VERSION__).toBe('v2');
        expect('_runtimeV2' in selected).toBe(true);
        expect(callback).toHaveBeenCalledTimes(1);
    });

    it('restores a fresh V1 engine after simulated flag-off restart', () => {
        const beforeRestart: ClientHookEngineGlobal = {};
        const afterRestart: ClientHookEngineGlobal = {};

        expect(
            '_runtimeV2' in getOrCreateClientHookEngine(beforeRestart, 'v2'),
        ).toBe(true);
        expect(
            '_runtimeV2' in getOrCreateClientHookEngine(afterRestart, 'v1'),
        ).toBe(false);
        expect(afterRestart.__NUXT_HOOKS_VERSION__).toBe('v1');
    });
});
