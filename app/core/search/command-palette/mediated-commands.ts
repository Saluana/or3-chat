import type { PaletteActionResult, PaletteCommandHandler } from './types';

/**
 * Host-mediated command channel for isolated V2 plugins.
 * Command metadata is declarative; handlers remain in the host/plugin scope
 * and are never serialized across iframe/worker boundaries.
 */

type MediatedEntry = {
    pluginId: string;
    generation: number;
    handler: PaletteCommandHandler;
};

const registry = new Map<string, MediatedEntry>();

export function registerMediatedPaletteCommand(options: {
    commandId: string;
    pluginId: string;
    generation: number;
    handler: PaletteCommandHandler;
}): () => void {
    const key = mediatedKey(options.pluginId, options.commandId);
    registry.set(key, {
        pluginId: options.pluginId,
        generation: options.generation,
        handler: options.handler,
    });
    return () => {
        const current = registry.get(key);
        if (
            current &&
            current.pluginId === options.pluginId &&
            current.generation === options.generation
        ) {
            registry.delete(key);
        }
    };
}

export async function executeMediatedPaletteCommand(options: {
    commandId: string;
    pluginId: string;
    expectedGeneration: number;
}): Promise<PaletteActionResult> {
    const key = mediatedKey(options.pluginId, options.commandId);
    const entry = registry.get(key);
    if (!entry) {
        return {
            ok: false,
            error: {
                code: 'not-found',
                message: `Mediated command "${options.commandId}" not found`,
            },
        };
    }
    if (entry.generation !== options.expectedGeneration) {
        return {
            ok: false,
            error: {
                code: 'stale-plugin',
                message: 'Plugin generation changed before command execution',
            },
        };
    }
    try {
        return await entry.handler();
    } catch (error) {
        return {
            ok: false,
            error: {
                code: 'execution-failed',
                message:
                    error instanceof Error
                        ? error.message
                        : 'Mediated command failed',
                cause: error,
            },
        };
    }
}

function mediatedKey(pluginId: string, commandId: string): string {
    return `${pluginId}::${commandId}`;
}

/** Test helper */
export function __resetMediatedPaletteCommandsForTests(): void {
    registry.clear();
}
