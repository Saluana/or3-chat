import { describe, expect, it, vi } from 'vitest';
import { createTypedAdminHookEngine } from '../typed-hooks';
import { createHookEngine } from '../hook-engine';
import { createServerHookEngine } from '../runtime-kernel';

describe('server hook runtime kernel lifetimes', () => {
    it('creates isolated V2 engines for specialized server owners', async () => {
        const authOwner = createServerHookEngine('v2');
        const adminOwner = createServerHookEngine('v2');
        const callback = vi.fn();
        authOwner.addAction('server.action', callback);

        await authOwner.doAction('server.action');
        await adminOwner.doAction('server.action');

        expect(authOwner).not.toBe(adminOwner);
        expect(callback).toHaveBeenCalledTimes(1);
        expect('_runtimeV2' in authOwner).toBe(true);
        expect('_runtimeV2' in adminOwner).toBe(true);
    });

    it('preserves typed admin wrappers and filter-kind inference over V2', async () => {
        const engine = createServerHookEngine('v2');
        const typed = createTypedAdminHookEngine(engine);
        const filter = vi.fn((value: unknown) => value);
        const dispose = engine.on('admin.demo:filter:value', filter);

        await engine.applyFilters('admin.demo:filter:value', 'value');
        dispose();

        expect(filter).toHaveBeenCalledWith('value');
        expect(typed._engine).toBe(engine);
        expect(typed._diagnostics).toBe(engine._diagnostics);
    });

    it('retains V1 as the exported production factory until startup cutover', () => {
        expect('_runtimeV2' in createHookEngine()).toBe(false);
        expect('_runtimeV2' in createServerHookEngine('v2')).toBe(true);
    });
});
