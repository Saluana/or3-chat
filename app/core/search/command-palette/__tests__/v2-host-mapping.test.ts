import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostRpcHandlerContext } from '~~/shared/plugins/isolation/host-rpc-broker';
import {
    __resetPaletteRegistryForTests,
    getPaletteCommand,
} from '../registry';
import { __resetMediatedPaletteCommandsForTests } from '../mediated-commands';
import { createV2PaletteContributionHost } from '../v2-host-mapping';

describe('V2 command-palette contribution host', () => {
    beforeEach(() => {
        __resetPaletteRegistryForTests();
        __resetMediatedPaletteCommandsForTests();
    });

    it('maps RPC contributions and executes through the mediated host callback', async () => {
        const controller = new AbortController();
        const executeCommand = vi.fn(async () => ({ ok: true as const }));
        const host = createV2PaletteContributionHost({ executeCommand });
        const context: HostRpcHandlerContext = {
            pluginId: 'todo-plugin',
            workspaceId: 'ws-1',
            generation: 7,
            requestId: 'request-1',
            signal: controller.signal,
        };

        await host.contribute(
            {
                contribution: {
                    kind: 'ui.command-palette.command',
                    id: 'todo-new',
                    definition: {
                        id: 'todo-new',
                        label: 'New todo',
                    },
                },
            },
            context
        );

        const command = getPaletteCommand('todo-new');
        expect(command?.pluginId).toBe('todo-plugin');
        await expect(command?.handler()).resolves.toEqual({ ok: true });
        expect(executeCommand).toHaveBeenCalledWith({
            pluginId: 'todo-plugin',
            generation: 7,
            commandId: 'todo-new',
        });

        controller.abort();
        expect(getPaletteCommand('todo-new')).toBeUndefined();
        host.dispose();
    });

    it('rejects mismatched declarative contribution IDs', async () => {
        const host = createV2PaletteContributionHost();
        const context: HostRpcHandlerContext = {
            pluginId: 'todo-plugin',
            workspaceId: 'ws-1',
            generation: 1,
            requestId: 'request-1',
            signal: new AbortController().signal,
        };
        expect(() =>
            host.contribute(
                {
                    kind: 'ui.command-palette.command',
                    id: 'one',
                    definition: { id: 'two', label: 'Bad' },
                },
                context
            )
        ).toThrow(/must match/);
    });
});
