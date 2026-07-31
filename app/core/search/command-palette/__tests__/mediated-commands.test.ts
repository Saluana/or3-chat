import { beforeEach, describe, expect, it } from 'vitest';
import {
    __resetMediatedPaletteCommandsForTests,
    executeMediatedPaletteCommand,
    registerMediatedPaletteCommand,
} from '../mediated-commands';

describe('mediated palette commands', () => {
    beforeEach(() => {
        __resetMediatedPaletteCommandsForTests();
    });

    it('executes handlers in the host and rejects stale generations', async () => {
        registerMediatedPaletteCommand({
            commandId: 'todo-new',
            pluginId: 'example-todo',
            generation: 1,
            handler: async () => ({ ok: true }),
        });

        await expect(
            executeMediatedPaletteCommand({
                commandId: 'todo-new',
                pluginId: 'example-todo',
                expectedGeneration: 1,
            })
        ).resolves.toEqual({ ok: true });

        await expect(
            executeMediatedPaletteCommand({
                commandId: 'todo-new',
                pluginId: 'example-todo',
                expectedGeneration: 2,
            })
        ).resolves.toMatchObject({
            ok: false,
            error: { code: 'stale-plugin' },
        });
    });
});
