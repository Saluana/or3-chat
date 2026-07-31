import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    __resetPaletteRegistryForTests,
    registerPaletteCommand,
} from '../registry';
import { executePaletteAction } from '../action-executor';
import type { PaletteHostContext } from '../types';

vi.mock('~/utils/errors', () => ({
    reportError: vi.fn(),
}));

describe('executePaletteAction', () => {
    beforeEach(() => {
        __resetPaletteRegistryForTests();
    });

    it('dispatches command targets and honors closeOnSuccess', async () => {
        registerPaletteCommand(
            { id: 'new-chat', label: 'New chat', closeOnSuccess: false },
            () => ({ ok: true })
        );
        const host: PaletteHostContext = {
            openChat: vi.fn(),
            openDocument: vi.fn(),
            openPaneApp: vi.fn(),
            revealProject: vi.fn(),
            openSystemPrompts: vi.fn(),
            openDashboard: vi.fn(),
            openImage: vi.fn(),
            executeCommand: async (commandId) => {
                if (commandId !== 'new-chat') {
                    return {
                        ok: false,
                        error: { code: 'not-found', message: 'missing' },
                    };
                }
                return { ok: true, closeOnSuccess: false };
            },
            canOpenNewPane: () => true,
        };

        const result = await executePaletteAction({
            host,
            action: {
                id: 'run',
                label: 'Run',
                target: { kind: 'command', commandId: 'new-chat' },
            },
        });
        expect(result).toEqual({ ok: true, closeOnSuccess: false });
    });

    it('keeps palette open semantics on failure', async () => {
        const host: PaletteHostContext = {
            openChat: async () => ({
                ok: false,
                error: { code: 'not-found', message: 'gone' },
            }),
            openDocument: vi.fn(),
            openPaneApp: vi.fn(),
            revealProject: vi.fn(),
            openSystemPrompts: vi.fn(),
            openDashboard: vi.fn(),
            openImage: vi.fn(),
            executeCommand: vi.fn(),
            canOpenNewPane: () => true,
        };
        const result = await executePaletteAction({
            host,
            action: {
                id: 'open',
                label: 'Open',
                target: {
                    kind: 'chat',
                    threadId: 'missing',
                    destination: 'active',
                },
            },
        });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe('not-found');
    });

    it('rejects disabled actions', async () => {
        const host = {
            openChat: vi.fn(),
            openDocument: vi.fn(),
            openPaneApp: vi.fn(),
            revealProject: vi.fn(),
            openSystemPrompts: vi.fn(),
            openDashboard: vi.fn(),
            openImage: vi.fn(),
            executeCommand: vi.fn(),
            canOpenNewPane: () => false,
        } satisfies PaletteHostContext;
        const result = await executePaletteAction({
            host,
            action: {
                id: 'new-pane',
                label: 'Open in New Pane',
                disabled: true,
                disabledReason: 'Pane capacity reached',
                target: {
                    kind: 'chat',
                    threadId: 't1',
                    destination: 'new-pane',
                },
            },
        });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe('disabled');
        expect(host.openChat).not.toHaveBeenCalled();
    });

    it('rejects a stale plugin command instead of executing its replacement', async () => {
        registerPaletteCommand(
            { id: 'plugin-run', label: 'Run' },
            () => ({ ok: true }),
            { pluginId: 'example', pluginGeneration: 2 }
        );
        const host = {
            openChat: vi.fn(),
            openDocument: vi.fn(),
            openPaneApp: vi.fn(),
            revealProject: vi.fn(),
            openSystemPrompts: vi.fn(),
            openDashboard: vi.fn(),
            openImage: vi.fn(),
            executeCommand: vi.fn(),
            canOpenNewPane: () => true,
        } satisfies PaletteHostContext;

        const result = await executePaletteAction({
            host,
            action: {
                id: 'plugin-run',
                label: 'Run',
                target: {
                    kind: 'command',
                    commandId: 'plugin-run',
                    expectedPluginGeneration: 1,
                },
            },
        });

        expect(result).toMatchObject({
            ok: false,
            error: { code: 'stale-plugin' },
        });
        expect(host.executeCommand).not.toHaveBeenCalled();
    });

    it('dispatches system prompt edit targets', async () => {
        const openSystemPrompts = vi.fn().mockResolvedValue({ ok: true });
        const host = {
            openChat: vi.fn(),
            openDocument: vi.fn(),
            openPaneApp: vi.fn(),
            revealProject: vi.fn(),
            openSystemPrompts,
            openDashboard: vi.fn(),
            openImage: vi.fn(),
            executeCommand: vi.fn(),
            canOpenNewPane: () => true,
        } satisfies PaletteHostContext;

        await expect(
            executePaletteAction({
                host,
                action: {
                    id: 'edit-prompt',
                    label: 'Edit prompt',
                    target: {
                        kind: 'system-prompt',
                        mode: 'edit',
                        promptId: 'prompt-1',
                    },
                },
            })
        ).resolves.toEqual({ ok: true });
        expect(openSystemPrompts).toHaveBeenCalledWith({
            mode: 'edit',
            promptId: 'prompt-1',
        });
    });
});
