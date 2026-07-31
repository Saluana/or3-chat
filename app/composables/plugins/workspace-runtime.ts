import { registerDashboardPlugin } from '~/composables/dashboard/useDashboardPlugins';
import { registerSidebarPage } from '~/composables/sidebar/registerSidebarPage';
import { usePaneApps } from '~/composables/core/usePaneApps';
import { registerMessageAction } from '~/composables/chat/useMessageActions';
import { useToolRegistry } from '~/utils/chat/tools-public';
import type { DashboardPlugin } from '~/composables/dashboard/useDashboardPlugins';
import type { SidebarPageDef } from '~/composables/sidebar/useSidebarPages';
import type { PaneAppDef } from '~/composables/core/usePaneApps';
import type { ChatMessageAction } from '~/composables/chat/useMessageActions';
import type { ExtendedToolDefinition, ToolHandler } from '~/utils/chat/tool-registry';
import type { RegistrationHandle } from '~~/shared/plugins/registration-handle';
import {
    LegacyPluginScope,
    type LegacyCleanupReport,
} from '~~/shared/plugins/legacy-plugin-scope';
import {
    registerPaletteCommand,
} from '~/core/search/command-palette/registry';
import { registerPluginPostSource } from '~/core/search/command-palette/sources/register-core';
import type {
    PaletteCommandDefinition,
    PaletteCommandHandler,
    PalettePostSourceDefinition,
} from '~/core/search/command-palette/types';

export type WorkspacePluginSource = 'builtin' | 'extension';

const SOURCE_PRIORITY: Record<WorkspacePluginSource, number> = {
    builtin: 1,
    extension: 2,
};

export interface Or3WorkspacePluginApi {
    registerDashboardPlugin: (plugin: DashboardPlugin) => RegistrationHandle;
    registerSidebarPage: (def: SidebarPageDef) => () => void;
    registerPaneApp: (def: PaneAppDef) => RegistrationHandle;
    registerMessageAction: (action: ChatMessageAction) => RegistrationHandle;
    registerTool: (def: ExtendedToolDefinition, handler: ToolHandler) => RegistrationHandle;
    registerCommandPalettePostSource: (
        definition: PalettePostSourceDefinition
    ) => RegistrationHandle;
    registerCommandPaletteCommand: (
        definition: PaletteCommandDefinition,
        handler: PaletteCommandHandler
    ) => RegistrationHandle;
    onCleanup: (fn: () => void | Promise<void>) => void;
}

export interface Or3WorkspacePlugin {
    id: string;
    register(api: Or3WorkspacePluginApi): void | Promise<void>;
}

type WorkspacePluginInstance = {
    id: string;
    source: WorkspacePluginSource;
    dispose: () => void | Promise<void>;
};

type WorkspaceRuntimeGlobals = typeof globalThis & {
    __or3WorkspacePluginInstances?: Map<string, WorkspacePluginInstance>;
};

const globals = globalThis as WorkspaceRuntimeGlobals;
const instanceRegistry =
    globals.__or3WorkspacePluginInstances ??
    (globals.__or3WorkspacePluginInstances = new Map<string, WorkspacePluginInstance>());

function toDisposer(
    handle: RegistrationHandle | (() => void)
): () => void {
    if (typeof handle === 'function') {
        return handle;
    }
    return () => {
        handle.dispose();
    };
}

function attachOwnerPluginId<T extends { pluginId?: string }>(
    definition: T,
    ownerPluginId?: string
): T {
    if (!ownerPluginId || definition.pluginId !== undefined) {
        return definition;
    }
    return { ...definition, pluginId: ownerPluginId };
}

export interface ManagedWorkspacePluginRuntime {
    api: Or3WorkspacePluginApi;
    dispose: (reason?: unknown) => Promise<LegacyCleanupReport>;
}

/** Internal manager adapter. The public V1 factory below intentionally hides its report. */
export function createManagedWorkspacePluginRuntime(options?: {
    pluginId?: string;
}): ManagedWorkspacePluginRuntime {
    const ownerPluginId = options?.pluginId;
    const palettePluginId = ownerPluginId ?? 'workspace-plugin';
    const scope = new LegacyPluginScope({
        onCleanupError({ error }) {
            if (import.meta.dev) {
                console.warn('[workspace-plugin-runtime] cleanup failed', error);
            }
        },
    });
    const { registerPaneApp } = usePaneApps();
    const tools = useToolRegistry();

    const api: Or3WorkspacePluginApi = {
        registerDashboardPlugin(plugin) {
            const handle = registerDashboardPlugin(
                attachOwnerPluginId(plugin, ownerPluginId)
            );
            const cleanup = toDisposer(handle);
            scope.onCleanup(cleanup);
            return handle;
        },
        registerSidebarPage(def) {
            const cleanup = registerSidebarPage(
                attachOwnerPluginId(def, ownerPluginId),
                {
                    clientOnly: true,
                    hmrCleanup: false,
                }
            );
            scope.onCleanup(cleanup);
            return cleanup;
        },
        registerPaneApp(def) {
            const handle = registerPaneApp(
                attachOwnerPluginId(def, ownerPluginId)
            );
            const cleanup = toDisposer(handle);
            scope.onCleanup(cleanup);
            return handle;
        },
        registerMessageAction(action) {
            const handle = registerMessageAction(
                attachOwnerPluginId(action, ownerPluginId)
            );
            const cleanup = toDisposer(handle);
            scope.onCleanup(cleanup);
            return handle;
        },
        registerTool(def, handler) {
            const tool = tools.registerTool(def, handler, { override: true });
            let disposed = false;
            const handle: RegistrationHandle = {
                id: def.function.name,
                owner: tool._owner,
                get disposed() {
                    return disposed;
                },
                dispose() {
                    if (disposed) return false;
                    const removed = tool.dispose();
                    disposed = true;
                    return removed;
                },
            };
            scope.onCleanup(() => {
                handle.dispose();
            });
            return handle;
        },
        registerCommandPalettePostSource(definition) {
            const handle = registerPluginPostSource({
                definition,
                pluginId: palettePluginId,
            });
            scope.onCleanup(() => {
                handle.dispose();
            });
            return handle;
        },
        registerCommandPaletteCommand(definition, handler) {
            const handle = registerPaletteCommand(definition, handler, {
                pluginId: palettePluginId,
            });
            scope.onCleanup(() => {
                handle.dispose();
            });
            return handle;
        },
        onCleanup(fn) {
            scope.onCleanup(fn);
        },
    };

    return {
        api,
        dispose: (reason) => scope.dispose(reason),
    };
}

export function createWorkspacePluginApi(pluginId?: string): {
    api: Or3WorkspacePluginApi;
    dispose: () => void;
} {
    const runtime = createManagedWorkspacePluginRuntime({ pluginId });
    return {
        api: runtime.api,
        dispose() {
            // Invocation remains synchronous/FIFO. Promise settlement is owned
            // by the compatibility scope without changing this V1 void return.
            void runtime.dispose();
        },
    };
}

export function registerWorkspacePluginInstance(
    id: string,
    source: WorkspacePluginSource,
    dispose: () => void | Promise<void>
): { accepted: boolean; replacedSource?: WorkspacePluginSource } {
    const current = instanceRegistry.get(id);
    if (current) {
        const incomingPriority = SOURCE_PRIORITY[source];
        const currentPriority = SOURCE_PRIORITY[current.source];
        if (incomingPriority < currentPriority) {
            return { accepted: false, replacedSource: current.source };
        }
        try {
            const result = current.dispose();
            if (result && typeof (result as Promise<void>).then === 'function') {
                void result;
            }
        } catch (error) {
            if (import.meta.dev) {
                console.warn('[workspace-plugin-runtime] previous dispose failed', error);
            }
        }
    }

    instanceRegistry.set(id, {
        id,
        source,
        dispose,
    });
    return { accepted: true, replacedSource: current?.source };
}

export function unregisterWorkspacePluginInstance(id: string): void {
    const current = instanceRegistry.get(id);
    if (!current) return;
    instanceRegistry.delete(id);
    try {
        const result = current.dispose();
        if (result && typeof (result as Promise<void>).then === 'function') {
            void result;
        }
    } catch (error) {
        if (import.meta.dev) {
            console.warn('[workspace-plugin-runtime] dispose failed', error);
        }
    }
}

export function listWorkspacePluginInstances(): Array<{ id: string; source: WorkspacePluginSource }> {
    return Array.from(instanceRegistry.values()).map((entry) => ({
        id: entry.id,
        source: entry.source,
    }));
}
