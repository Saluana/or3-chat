import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    HookCallbackTimeoutError,
    LEGACY_HOOK_POLICY,
    createHookEngineV2,
} from '../hook-engine-v2';

afterEach(() => {
    vi.useRealTimers();
});

describe('Hook Runtime V2 explicit policies', () => {
    it('keeps unknown hooks on the legacy serial/continue/no-timeout policy', async () => {
        const engine = createHookEngineV2();
        const calls: string[] = [];
        engine.addAction('unknown.action', async () => {
            calls.push('first:start');
            await Promise.resolve();
            calls.push('first:end');
            throw new Error('continue');
        });
        engine.addAction('unknown.action', () => calls.push('second'));

        await expect(
            engine.doAction('unknown.action'),
        ).resolves.toBeUndefined();

        expect(calls).toEqual(['first:start', 'first:end', 'second']);
        expect(LEGACY_HOOK_POLICY).toEqual({
            actionMode: 'series',
            errorPolicy: 'continue',
            filterMode: 'series',
            timeoutMs: null,
            syncThenablePolicy: 'reject-and-continue',
        });
    });

    it('starts callbacks concurrently for an explicitly parallel action', async () => {
        const engine = createHookEngineV2();
        engine._runtimeV2.defineHook({
            kind: 'action',
            name: 'new.parallel',
            policy: { actionMode: 'parallel' },
        });
        let started = 0;
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        engine.addAction('new.parallel', async () => {
            started += 1;
            await gate;
        });
        engine.addAction('new.parallel', async () => {
            started += 1;
            await gate;
        });

        const dispatch = engine.doAction('new.parallel');
        await Promise.resolve();
        await Promise.resolve();
        expect(started).toBe(2);
        release();
        await dispatch;
    });

    it('times out a callback and continues only when the hook opts in', async () => {
        vi.useFakeTimers();
        const errors: unknown[] = [];
        const engine = createHookEngineV2({
            logCallbackError: ({ error }) => errors.push(error),
        });
        engine._runtimeV2.defineHook({
            kind: 'action',
            name: 'new.timeout',
            policy: { timeoutMs: 25 },
        });
        const later = vi.fn();
        engine.addAction('new.timeout', () => new Promise(() => {}));
        engine.addAction('new.timeout', later, 20);

        const dispatch = engine.doAction('new.timeout');
        await vi.advanceTimersByTimeAsync(25);
        await dispatch;

        expect(later).toHaveBeenCalledTimes(1);
        expect(errors[0]).toBeInstanceOf(HookCallbackTimeoutError);
    });

    it('stops the serial chain without rethrowing under stop policy', async () => {
        const engine = createHookEngineV2();
        const later = vi.fn();
        engine._runtimeV2.defineHook({
            kind: 'action',
            name: 'new.stop',
            policy: { errorPolicy: 'stop' },
        });
        engine.addAction('new.stop', () => {
            throw new Error('stop');
        });
        engine.addAction('new.stop', later, 20);

        await expect(engine.doAction('new.stop')).resolves.toBeUndefined();
        expect(later).not.toHaveBeenCalled();
    });

    it('collects every serial failure under aggregate policy', async () => {
        const engine = createHookEngineV2();
        const after = vi.fn();
        engine._runtimeV2.defineHook({
            kind: 'action',
            name: 'new.aggregate',
            policy: { errorPolicy: 'aggregate' },
        });
        engine.addAction('new.aggregate', () => {
            throw new Error('first');
        });
        engine.addAction('new.aggregate', () => {
            throw new Error('second');
        });
        engine.addAction('new.aggregate', after);

        const error = await engine
            .doAction('new.aggregate')
            .catch((caught) => caught);
        expect(error).toBeInstanceOf(AggregateError);
        expect((error as AggregateError).errors).toHaveLength(2);
        expect(after).toHaveBeenCalledTimes(1);
    });

    it('rethrows immediately and skips later callbacks under rethrow policy', async () => {
        const engine = createHookEngineV2();
        const failure = new Error('rethrow');
        const later = vi.fn();
        engine._runtimeV2.defineHook({
            kind: 'action',
            name: 'new.rethrow',
            policy: { errorPolicy: 'rethrow' },
        });
        engine.addAction('new.rethrow', () => {
            throw failure;
        });
        engine.addAction('new.rethrow', later);

        await expect(engine.doAction('new.rethrow')).rejects.toBe(failure);
        expect(later).not.toHaveBeenCalled();
    });

    it('returns false and stops a filter chain under fail-closed policy', async () => {
        const engine = createHookEngineV2();
        const later = vi.fn((value) => value);
        engine._runtimeV2.defineHook({
            kind: 'filter',
            name: 'new.constraint',
            policy: { errorPolicy: 'fail-closed' },
        });
        engine.addFilter('new.constraint', (value) => `${String(value)}-ok`, 5);
        engine.addFilter('new.constraint', () => {
            throw new Error('deny');
        });
        engine.addFilter('new.constraint', later, 20);

        await expect(
            engine.applyFilters('new.constraint', 'start'),
        ).resolves.toBe(false);
        expect(later).not.toHaveBeenCalled();
    });

    it('validates policies and selects definitions by exact kind and name only', async () => {
        const engine = createHookEngineV2();
        expect(() =>
            engine._runtimeV2.defineHook({
                kind: 'filter',
                name: 'bad.parallel',
                policy: { actionMode: 'parallel' },
            }),
        ).toThrow('only valid for action');
        expect(() =>
            engine._runtimeV2.defineHook({
                kind: 'action',
                name: 'bad.closed',
                policy: { errorPolicy: 'fail-closed' },
            }),
        ).toThrow('only valid for filter');
        expect(() =>
            engine._runtimeV2.defineHook({
                kind: 'action',
                name: 'bad.timeout',
                policy: { timeoutMs: 0 },
            }),
        ).toThrow('positive finite');

        const definition = engine._runtimeV2.defineHook({
            kind: 'action',
            name: 'new.exact',
            policy: { errorPolicy: 'rethrow' },
        });
        engine.addAction('new.exact.other', () => {
            throw new Error('legacy-continue');
        });

        await expect(
            engine.doAction('new.exact.other'),
        ).resolves.toBeUndefined();
        expect(Object.isFrozen(definition)).toBe(true);
        expect(Object.isFrozen(definition.policy)).toBe(true);
        expect(engine._runtimeV2.inspectDefinitions()).toEqual([definition]);
        expect(Object.isFrozen(engine._runtimeV2.inspectDefinitions())).toBe(
            true,
        );
    });
});
