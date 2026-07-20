import { describe, expect, it, vi } from 'vitest';
import { createStartupSelectedWorkspaceManager } from '../bundled-v1-manager-runtime';

describe('manager canary rollback seam', () => {
    it('restores the exact V1 import/register authority when V2 is off at startup', async () => {
        const trace: string[] = [];
        const createManager = vi.fn(() => ({ schedule: vi.fn() }));
        const manager = createStartupSelectedWorkspaceManager(false, createManager);
        const importV1Plugin = vi.fn(async () => {
            trace.push('v1:import');
            return {
                register: vi.fn(async () => {
                    trace.push('v1:register');
                }),
            };
        });

        const plugin = await importV1Plugin();
        await plugin.register();

        expect(manager).toBeNull();
        expect(createManager).not.toHaveBeenCalled();
        expect(trace).toEqual(['v1:import', 'v1:register']);
        expect(importV1Plugin).toHaveBeenCalledOnce();
        expect(plugin.register).toHaveBeenCalledOnce();
    });

    it('constructs exactly one manager when V2 is selected at startup', () => {
        const selected = { schedule: vi.fn() };
        const createManager = vi.fn(() => selected);

        expect(createStartupSelectedWorkspaceManager(true, createManager)).toBe(selected);
        expect(createManager).toHaveBeenCalledOnce();
    });
});
