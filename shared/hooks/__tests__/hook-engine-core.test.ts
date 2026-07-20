import { describe, expect, it } from 'vitest';
import { createHookEngine } from '../hook-engine-core';

describe('hook-engine-core', () => {
    it('rejects thenables from synchronous filters and keeps prior value', () => {
        const engine = createHookEngine();
        engine.addFilter('demo:filter:value', () => Promise.resolve('async') as unknown as string);

        const result = engine.applyFiltersSync('demo:filter:value', 'sync');
        expect(result).toBe('sync');
        expect(engine._diagnostics.errors['demo:filter:value']).toBe(1);
    });

    it('awaits onceAction callbacks during doAction and removes them after first run', async () => {
        const engine = createHookEngine();
        let calls = 0;
        engine.onceAction('demo:action:once', async () => {
            calls += 1;
            await Promise.resolve();
        });

        await engine.doAction('demo:action:once');
        await engine.doAction('demo:action:once');
        expect(calls).toBe(1);
    });

    it('records onceAction async rejection without leaving unhandled failures', async () => {
        const engine = createHookEngine();
        engine.onceAction('demo:action:fail', async () => {
            throw new Error('boom');
        });

        await expect(engine.doAction('demo:action:fail')).resolves.toBeUndefined();
        expect(engine._diagnostics.errors['demo:action:fail']).toBe(1);
        expect(engine.hasAction('demo:action:fail')).toBe(false);
    });
});
