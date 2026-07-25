import type { RegistrationHandle } from '~~/shared/plugins/registration-handle';
import {
    listPalettePostSourceDefinitions,
    registerPalettePostSourceDefinition,
    registerPaletteSource,
} from '../registry';
import type { PalettePostSourceDefinition } from '../types';
import { createChatPaletteSource } from './chat-source';
import {
    createCommandPaletteSource,
    createDefaultCoreCommandSpecs,
    registerCorePaletteCommands,
    type CoreCommandSpec,
} from './command-source';
import { createDashboardPaletteSource } from './dashboard-source';
import { createDocumentPaletteSource } from './document-source';
import { createImagePaletteSource } from './image-source';
import { createPluginPostPaletteSource } from './plugin-post-source';
import { createProjectPaletteSource } from './project-source';

let registered = false;
const handles: RegistrationHandle[] = [];

/**
 * Register core palette sources and optional core commands once per runtime.
 */
export function registerCorePaletteSources(options?: {
    commandSpecs?: readonly CoreCommandSpec[];
    commandDeps?: Parameters<typeof createDefaultCoreCommandSpecs>[0];
}): void {
    if (registered) return;
    registered = true;

    const isFeatureEnabled =
        options?.commandDeps?.isFeatureEnabled ?? (() => true);

    handles.push(registerPaletteSource(createCommandPaletteSource()));
    handles.push(registerPaletteSource(createChatPaletteSource()));
    if (isFeatureEnabled('documents')) {
        handles.push(registerPaletteSource(createDocumentPaletteSource()));
    }
    handles.push(registerPaletteSource(createProjectPaletteSource()));
    if (isFeatureEnabled('dashboard')) {
        handles.push(registerPaletteSource(createImagePaletteSource()));
        handles.push(registerPaletteSource(createDashboardPaletteSource()));
    }

    // Materialize any already-registered plugin post-source definitions.
    for (const definition of listPalettePostSourceDefinitions()) {
        handles.push(
            registerPaletteSource(
                createPluginPostPaletteSource({
                    definition,
                    pluginId: definition.pluginId,
                    pluginGeneration: definition.pluginGeneration,
                })
            )
        );
    }

    const specs =
        options?.commandSpecs ??
        createDefaultCoreCommandSpecs(options?.commandDeps ?? {});
    registerCorePaletteCommands(specs);
}

/**
 * Ensure a post-source definition has a live search source registered.
 */
export function ensurePluginPostSourceRegistered(options: {
    definition: Parameters<typeof createPluginPostPaletteSource>[0]['definition'];
    pluginId: string;
    pluginGeneration?: number;
}): RegistrationHandle {
    const source = createPluginPostPaletteSource(options);
    return registerPaletteSource(source);
}

/** Atomically register plugin post-source metadata, aliases, and live index source. */
export function registerPluginPostSource(options: {
    definition: PalettePostSourceDefinition;
    pluginId: string;
    pluginGeneration?: number;
}): RegistrationHandle {
    const defHandle = registerPalettePostSourceDefinition(options.definition, {
        pluginId: options.pluginId,
        pluginGeneration: options.pluginGeneration,
    });
    let sourceHandle: RegistrationHandle;
    try {
        sourceHandle = ensurePluginPostSourceRegistered(options);
    } catch (error) {
        defHandle.dispose();
        throw error;
    }
    return {
        id: options.definition.id,
        owner: defHandle.owner,
        get disposed() {
            return defHandle.disposed && sourceHandle.disposed;
        },
        dispose() {
            const sourceRemoved = sourceHandle.dispose();
            const definitionRemoved = defHandle.dispose();
            return sourceRemoved || definitionRemoved;
        },
    };
}

/** Test helper */
export function __resetCorePaletteSourcesForTests(): void {
    for (const handle of handles.splice(0)) {
        handle.dispose();
    }
    registered = false;
}
