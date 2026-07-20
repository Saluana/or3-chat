import { describe, expect, it } from 'vitest';
import { createHookEngine as createV1HookEngine } from '~~/shared/hooks/hook-engine-core';
import { createHookEngineV2 } from '~~/shared/hooks/hook-engine-v2';
import {
    readHookInspectorSnapshot,
    resetHookInspectorDiagnostics,
} from '../hook-inspector-snapshot';

describe('Hook Inspector diagnostics snapshots', () => {
    it('retains a read-only V1 fallback without changing the mutable facade', () => {
        const engine = createV1HookEngine();
        engine.addAction('demo.action', () => undefined);
        engine._diagnostics.timings['manual'] = [1, 2, 3];
        engine._diagnostics.errors['manual'] = 2;

        const snapshot = readHookInspectorSnapshot(engine);

        expect(snapshot).toMatchObject({
            source: 'v1-facade',
            timingStats: { manual: { count: 3, total: 6, max: 3 } },
            errors: { manual: 2 },
            totalActions: 1,
            totalFilters: 0,
        });
        expect(Object.isFrozen(snapshot)).toBe(true);
        expect(Object.isFrozen(snapshot.timings.manual)).toBe(true);
        expect(engine._diagnostics.timings.manual).toEqual([1, 2, 3]);
    });

    it('uses bounded immutable V2 samples while retaining aggregate invocation counts', () => {
        const engine = createHookEngineV2();
        engine.addAction('demo.action', () => undefined);
        for (let index = 0; index < 200; index++) {
            engine.doActionSync('demo.action');
        }

        const snapshot = readHookInspectorSnapshot(engine);

        expect(snapshot.source).toBe('v2-immutable');
        expect(snapshot.timings['demo.action']).toHaveLength(128);
        expect(snapshot.timingStats['demo.action']?.count).toBe(200);
        expect(snapshot.totalActions).toBe(1);
        expect(Object.isFrozen(snapshot.timingStats['demo.action'])).toBe(true);
    });

    it('resets V2 through the immutable runtime and clears the compatibility projection', () => {
        const engine = createHookEngineV2();
        engine.addAction('demo.action', () => {
            throw new Error('failure');
        });
        engine.doActionSync('demo.action');

        resetHookInspectorDiagnostics(engine);

        expect(readHookInspectorSnapshot(engine).timings).toEqual({});
        expect(readHookInspectorSnapshot(engine).errors).toEqual({});
        expect(engine._diagnostics.timings).toEqual({});
        expect(engine._diagnostics.errors).toEqual({});
    });
});
