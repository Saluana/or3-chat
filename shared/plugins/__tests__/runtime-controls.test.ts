import { describe, expect, it, vi } from 'vitest';
import {
    executeRuntimeControl,
    listRuntimeControls,
    type RuntimeControlContext,
    type RuntimeManagerControlSurface,
} from '../runtime-controls';
import type { Sha256 } from '../runtime-descriptor';

const KEY = 'sha256-' + 'a'.repeat(64) as Sha256;

function managerSurface(
    overrides: Partial<RuntimeManagerControlSurface> = {}
): RuntimeManagerControlSurface {
    return {
        listRecords: () => [
            {
                descriptor: { id: 'alpha', descriptorKey: KEY },
                status: 'quarantined',
                quarantinedDescriptorKey: KEY,
            },
        ],
        retry: vi.fn(() => true),
        schedule: vi.fn(async () => undefined),
        ...overrides,
    };
}

describe('runtime controls', () => {
    it('marks package operations unavailable without server surfaces', () => {
        const context: RuntimeControlContext = {
            managerV2Enabled: false,
            safeModeEnabled: false,
        };
        const byId = Object.fromEntries(
            listRuntimeControls(context).map((control) => [control.id, control])
        );
        expect(byId.retry?.availability.available).toBe(false);
        expect(byId.disable?.availability.available).toBe(false);
        expect(byId.rollback?.availability.available).toBe(false);
        expect(byId.inspect?.availability.available).toBe(true);
        expect(byId['safe-mode-guidance']?.availability.available).toBe(true);
        expect(byId.disable?.availability).toMatchObject({
            available: false,
        });
        expect(
            (byId.disable?.availability as { reason: string }).reason
        ).toMatch(/package lifecycle/i);
    });

    it('retries and clears quarantine through the manager', async () => {
        const manager = managerSurface();
        const context: RuntimeControlContext = {
            managerV2Enabled: true,
            safeModeEnabled: false,
            manager,
            descriptorKey: KEY,
        };
        expect(
            listRuntimeControls(context).find((control) => control.id === 'retry')
                ?.availability.available
        ).toBe(true);

        const retry = await executeRuntimeControl('retry', context);
        expect(retry.status).toBe('ok');
        expect(manager.retry).toHaveBeenCalledWith(KEY);
        expect(manager.schedule).toHaveBeenCalledWith('runtime-control:retry');

        const clear = await executeRuntimeControl('quarantine-clear', context);
        expect(clear.status).toBe('ok');
        expect(manager.schedule).toHaveBeenCalledWith('runtime-control:quarantine-clear');
    });

    it('disables via package lifecycle and keeps retention messaging', async () => {
        const disable = vi.fn(async () => ['other']);
        const result = await executeRuntimeControl('disable', {
            managerV2Enabled: true,
            safeModeEnabled: false,
            workspaceId: 'ws-1',
            pluginId: 'alpha',
            packageLifecycle: { disable },
        });
        expect(result.status).toBe('ok');
        expect(disable).toHaveBeenCalledWith('ws-1', 'alpha');
        expect(result.message).toMatch(/retained/i);
    });

    it('rolls back through promotion or reports blocked status', async () => {
        const rolled = await executeRuntimeControl('rollback', {
            managerV2Enabled: true,
            safeModeEnabled: false,
            pluginId: 'alpha',
            storedStateVersion: 1,
            snapshotState: () => ({ v: 1 }),
            restoreState: () => undefined,
            packagePromotion: {
                rollback: async () => ({ status: 'rolled-back' }),
            },
        });
        expect(rolled.status).toBe('ok');

        const blocked = await executeRuntimeControl('rollback', {
            managerV2Enabled: true,
            safeModeEnabled: false,
            pluginId: 'alpha',
            snapshotState: () => ({}),
            restoreState: () => undefined,
            packagePromotion: {
                rollback: async () => ({
                    status: 'blocked',
                    code: 'rollback-unsupported',
                }),
            },
        });
        expect(blocked.status).toBe('failed');
        expect(blocked.message).toMatch(/rollback-unsupported/);
    });

    it('inspects local records without claiming fleet visibility', async () => {
        const result = await executeRuntimeControl('inspect', {
            managerV2Enabled: true,
            safeModeEnabled: true,
            manager: managerSurface(),
            descriptorKey: KEY,
        });
        expect(result.status).toBe('ok');
        expect(result.detail).toMatchObject({
            scope: 'this-client',
            fleetWide: false,
            records: [{ pluginId: 'alpha', descriptorKey: KEY, status: 'quarantined' }],
        });
    });

    it('returns safe-mode guidance with explicit limitations', async () => {
        const result = await executeRuntimeControl('safe-mode-guidance', {
            managerV2Enabled: false,
            safeModeEnabled: false,
        });
        expect(result.status).toBe('ok');
        expect(result.detail).toMatchObject({
            limitations: expect.arrayContaining([
                'trusted-host grants are not a sandbox',
                'activation is not fleet-atomic',
                expect.stringMatching(/disable retains/i),
            ]),
        });
        expect(
            (result.detail as { steps: string[] }).steps.some((step) =>
                step.includes('OR3_DISABLE_NON_CORE_PLUGINS')
            )
        ).toBe(true);
    });

    it('explains unavailable actions instead of throwing', async () => {
        const result = await executeRuntimeControl('disable', {
            managerV2Enabled: true,
            safeModeEnabled: false,
            manager: managerSurface(),
        });
        expect(result).toEqual({
            status: 'unavailable',
            controlId: 'disable',
            message: expect.stringMatching(/package lifecycle/i),
        });
    });
});
