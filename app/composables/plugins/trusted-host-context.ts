import { defineComponent, h, type Component } from 'vue';
import {
    pluginError,
    pluginOk,
    validatePluginPaneOpenInput,
    type PluginCommandDefinition,
    type PluginContributionKind,
    type PluginGrant,
    type PluginJsonValue,
    type PluginRegistrationHandle,
    type PluginResult,
} from '@or3/plugin-sdk';
import {
    createHostPluginContext,
    createUnsupportedPluginClients,
    type HostPluginScope,
} from '@or3/plugin-sdk/host';
import type {
    PluginContext,
    PluginContribution,
    PluginHooks,
    PluginLogger,
} from '@or3/plugin-sdk';
import type { PluginSettingsClient, PluginStorageClient, PluginStorageRecord } from '@or3/plugin-sdk';
import type { ChatMessageAction } from '~/composables/chat/useMessageActions';
import type { ExtendedToolDefinition, ToolHandler } from '~/utils/chat/tool-registry';
import type { PalettePostSourceDefinition } from '~/core/search/command-palette/types';
import { getGlobalMultiPaneApi } from '~/utils/multiPaneApi';
import {
    createManagedWorkspacePluginRuntime,
    type Or3WorkspacePluginApi,
} from './workspace-runtime';
import { createTrustedMediation, type TrustedMediationOptions } from './trusted-mediation';
import {
    applyTrustedEditorExtensions,
    interceptTrustedEditorSend,
    registerTrustedEditorExtension,
    type TrustedEditorExtensionInput,
} from './trusted-editor';
import {
    registerTrustedExecutionModel,
    type TrustedModelContribution,
} from './trusted-models';
import { registerMessageRenderer, type MessageRendererDefinition } from '~/composables/chat/message-renderers';
import type { LegacyCleanupReport } from '~~/shared/plugins/legacy-plugin-scope';
import type { RegistrationHandle } from '~~/shared/plugins/registration-handle';

/**
 * Grants a trusted plugin may receive. Bundled V1 packages are loaded with
 * this full set because their `register(api)` path already had ungated
 * registry access. SDK context methods still check the grant they need.
 */
export const TRUSTED_HOST_GRANTS = [
    'ui.dashboard.register',
    'ui.sidebar.register',
    'ui.pane.register',
    'ui.card.register',
    'ui.action.register',
    'ui.command-palette.register',
    'ui.toast',
    'ui.confirm',
    'ui.progress',
    'panes.open',
    'commands.register',
    'commands.run.public',
    'chat.create',
    'chat.read',
    'chat.message.write',
    'chat.message.renderer',
    'chat.editor.extension',
    'workspace.read',
    'workspace.switch',
    'workspace.connections.read',
    'workspace.connections.manage',
    'events.register',
    'ai.models',
    'ai.complete',
    'secrets.read',
    'secrets.write',
    'secrets.use',
    'files.pick',
    'files.read',
    'files.write',
    'network.stream',
    'activity.register',
    'documents.read',
    'documents.write',
    'tools.register.client',
    'tools.register.server',
    'tools.model.register',
    'posts.read',
    'posts.write',
    'hooks.register',
    'network.http',
    'storage.read',
    'storage.write',
    'settings.read',
    'settings.write',
] as const satisfies readonly PluginGrant[];

const SURFACE_ICON = 'i-lucide-puzzle';

function pluginComponent(value: unknown): Component {
    if (typeof value === 'function' || (value !== null && typeof value === 'object')) {
        return value as Component;
    }
    return TrustedPluginSurface;
}

/** Used only when a registration does not pass its own component. */
const TrustedPluginSurface = defineComponent({
    name: 'TrustedPluginSurface',
    props: {
        paneId: { type: String, default: '' },
    },
    setup(props) {
        return () =>
            h('div', {
                'data-or3-trusted-plugin-surface': props.paneId || 'plugin',
            });
    },
});

export interface TrustedPluginToolsClient {
    register(
        definition: ExtendedToolDefinition,
        handler: ToolHandler
    ): PluginRegistrationHandle;
    registerModel(input: TrustedModelContribution): PluginRegistrationHandle;
}

export interface TrustedPluginEditorClient {
    register(input: TrustedEditorExtensionInput): PluginRegistrationHandle;
    applyExtensions(existing: readonly object[]): object[];
    handleBeforeSend(text: string): Promise<boolean>;
}

export interface CreateTrustedHostContextInput {
    readonly pluginId: string;
    readonly version: string;
    readonly workspaceId?: string;
    readonly generation?: number;
    readonly grants?: readonly PluginGrant[];
    readonly features?: readonly string[];
    readonly mediation?: Pick<
        TrustedMediationOptions,
        'fetch' | 'approvedDestinations' | 'secrets' | 'files' | 'posts'
    >;
}

export interface TrustedHostContext {
    readonly context: PluginContext;
    /** Client tools. The SDK context has no tools namespace; this is that surface. */
    readonly tools: TrustedPluginToolsClient;
    readonly editor: TrustedPluginEditorClient;
    readonly posts: ReturnType<typeof createTrustedMediation>['posts'];
    readonly renderers: {
        register(definition: MessageRendererDefinition): PluginRegistrationHandle;
    };
    /**
     * V1 `{ id, register(api) }` view. Tactics-style and bundled V1 modules
     * register through this object; it is the same runtime as `context`.
     */
    readonly workspaceApi: Or3WorkspacePluginApi;
    /** Live hook listeners owned by this context. Host leak diagnostic, not a plugin API. */
    readonly liveListenerCount: number;
    dispose(reason?: unknown): Promise<LegacyCleanupReport>;
}

interface ListenerEntry {
    disposed: boolean;
}

function denied(grant: PluginGrant): never {
    throw Object.assign(new Error(`Grant "${grant}" is required`), {
        code: 'permission-denied' as const,
        retryable: false,
    });
}

function invalid(message: string): never {
    throw Object.assign(new Error(message), {
        code: 'invalid-input' as const,
        retryable: false,
    });
}

function unsupported(message: string): never {
    throw Object.assign(new Error(message), {
        code: 'unsupported' as const,
        retryable: false,
    });
}

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
}

function toPluginHandle(
    handle: RegistrationHandle | (() => void)
): PluginRegistrationHandle {
    let disposed = false;
    return {
        dispose() {
            if (disposed) return;
            disposed = true;
            if (typeof handle === 'function') {
                handle();
                return;
            }
            handle.dispose();
        },
    };
}

function requireKey(key: string): void {
    if (typeof key !== 'string' || key.length === 0 || key.length > 256) {
        invalid('Storage key must be a string of 1 to 256 characters');
    }
}

function jsonSize(value: PluginJsonValue): number {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function createMemorySettings(
    granted: ReadonlySet<PluginGrant>,
    ended: () => boolean
): MemorySettings {
    const values = new Map<string, PluginJsonValue>();
    return {
        async get(key) {
            if (ended()) return pluginError('stale-context', 'Plugin context has ended');
            if (!granted.has('settings.read')) {
                return pluginError('permission-denied', 'Grant "settings.read" is required');
            }
            requireKey(key);
            const value = values.get(key);
            return pluginOk((value ?? null) as never);
        },
        async list() {
            if (ended()) return pluginError('stale-context', 'Plugin context has ended');
            if (!granted.has('settings.read')) {
                return pluginError('permission-denied', 'Grant "settings.read" is required');
            }
            return pluginOk(Object.fromEntries(values));
        },
        async set(key, value) {
            if (ended()) return pluginError('stale-context', 'Plugin context has ended');
            if (!granted.has('settings.write')) {
                return pluginError('permission-denied', 'Grant "settings.write" is required');
            }
            requireKey(key);
            values.set(key, value);
            return pluginOk(undefined);
        },
        async delete(key) {
            if (ended()) return pluginError('stale-context', 'Plugin context has ended');
            if (!granted.has('settings.write')) {
                return pluginError('permission-denied', 'Grant "settings.write" is required');
            }
            requireKey(key);
            values.delete(key);
            return pluginOk(undefined);
        },
        clear() {
            values.clear();
        },
    };
}

interface MemorySettings extends PluginSettingsClient {
    clear(): void;
}

interface MemoryStorage extends PluginStorageClient {
    clear(): void;
}

function createMemoryStorage(
    granted: ReadonlySet<PluginGrant>,
    ended: () => boolean
): MemoryStorage {
    const values = new Map<string, { value: PluginJsonValue; revision: number; updatedAt: number }>();
    const read = (method: 'storage.read') => {
        if (!granted.has(method)) {
            return pluginError('permission-denied', `Grant "${method}" is required`);
        }
        return null;
    };
    return {
        async get(key) {
            if (ended()) return pluginError('stale-context', 'Plugin context has ended');
            const blocked = read('storage.read');
            if (blocked) return blocked;
            requireKey(key);
            return pluginOk((values.get(key)?.value ?? null) as never);
        },
        async getRecord(key) {
            if (ended()) return pluginError('stale-context', 'Plugin context has ended');
            const blocked = read('storage.read');
            if (blocked) return blocked;
            requireKey(key);
            const current = values.get(key);
            const record: PluginStorageRecord = current
                ? {
                      value: current.value,
                      revision: current.revision,
                      sizeBytes: jsonSize(current.value),
                      updatedAt: current.updatedAt,
                  }
                : { value: null, revision: 0, sizeBytes: 0, updatedAt: 0 };
            return pluginOk(record as never);
        },
        async set(key, value, options) {
            if (ended()) return pluginError('stale-context', 'Plugin context has ended');
            if (!granted.has('storage.write')) {
                return pluginError('permission-denied', 'Grant "storage.write" is required');
            }
            requireKey(key);
            const current = values.get(key);
            if (options?.ifRevision !== undefined) {
                const actual = current ? current.revision : null;
                if (actual !== options.ifRevision) {
                    return pluginError('conflict', 'Storage revision does not match');
                }
            }
            values.set(key, {
                value,
                revision: (current?.revision ?? 0) + 1,
                updatedAt: Date.now(),
            });
            return pluginOk(undefined);
        },
        async delete(key) {
            if (ended()) return pluginError('stale-context', 'Plugin context has ended');
            if (!granted.has('storage.write')) {
                return pluginError('permission-denied', 'Grant "storage.write" is required');
            }
            requireKey(key);
            values.delete(key);
            return pluginOk(undefined);
        },
        async list(prefix) {
            if (ended()) return pluginError('stale-context', 'Plugin context has ended');
            const blocked = read('storage.read');
            if (blocked) return blocked;
            return pluginOk(
                [...values.entries()]
                    .filter(([key]) => (prefix ? key.startsWith(prefix) : true))
                    .map(([key, entry]) => ({
                        key,
                        sizeBytes: jsonSize(entry.value),
                        updatedAt: entry.updatedAt,
                        revision: entry.revision,
                    }))
            );
        },
        async listPage(options) {
            if (ended()) return pluginError('stale-context', 'Plugin context has ended');
            const blocked = read('storage.read');
            if (blocked) return blocked;
            const offset = options?.cursor ? Number(options.cursor) : 0;
            const limit = options?.limit ?? 50;
            const entries = [...values.entries()]
                .filter(([key]) => (options?.prefix ? key.startsWith(options.prefix) : true))
                .slice(offset, offset + limit)
                .map(([key, entry]) => ({
                    key,
                    sizeBytes: jsonSize(entry.value),
                    updatedAt: entry.updatedAt,
                    revision: entry.revision,
                }));
            const next = offset + entries.length;
            const total = [...values.keys()].filter((key) =>
                options?.prefix ? key.startsWith(options.prefix) : true
            ).length;
            return pluginOk({
                entries,
                ...(next < total ? { nextCursor: String(next) } : {}),
            });
        },
        clear() {
            values.clear();
        },
    };
}

function createLogger(pluginId: string): PluginLogger {
    const write = (
        level: 'debug' | 'info' | 'warn' | 'error',
        message: string,
        context?: Readonly<Record<string, unknown>>
    ) => {
        if (level === 'debug' && !import.meta.dev) return;
        const prefix = `[trusted-plugin:${pluginId}] ${message}`;
        if (context) console[level](prefix, context);
        else console[level](prefix);
    };
    return {
        debug: (message, context) => write('debug', message, context),
        info: (message, context) => write('info', message, context),
        warn: (message, context) => write('warn', message, context),
        error: (message, context) => write('error', message, context),
    };
}

/**
 * Host entry for the unified plugin runtime.
 *
 * SDK `context.ui`, `context.panes`, `context.commands`, `context.activity`,
 * and `tools` delegate to the V1 workspace registries. Chat message actions
 * register through `context.ui.registerAction({ surface: 'message' })` and
 * contribution kind `chat.action`, because the SDK chat client is
 * create/open/append rather than a registry. Vue component transfer stays a
 * host placeholder until the trusted-host ABI proofs land.
 */
export function createTrustedHostContext(
    input: CreateTrustedHostContextInput
): TrustedHostContext {
    const runtime = createManagedWorkspacePluginRuntime({ pluginId: input.pluginId });
    const controller = new AbortController();
    const granted = new Set<PluginGrant>(input.grants ?? []);
    const listeners: ListenerEntry[] = [];
    const activations: Array<() => void | Promise<void>> = [];
    let closed = false;
    const ended = () => closed || controller.signal.aborted;
    const settings = createMemorySettings(granted, ended);
    const storage = createMemoryStorage(granted, ended);

    function live(): void {
        if (ended()) {
            throw Object.assign(new Error('Plugin context has ended'), {
                code: 'stale-context' as const,
                retryable: false,
            });
        }
    }

    function allow(grant: PluginGrant): void {
        live();
        if (!granted.has(grant)) denied(grant);
    }

    function allowAny(primary: PluginGrant, alternates: readonly PluginGrant[] = []): void {
        live();
        if (granted.has(primary) || alternates.some((grant) => granted.has(grant))) return;
        denied(primary);
    }

    function registerSidebar(definition: {
        id: string;
        label: string;
        icon?: string;
        order?: number;
        component?: unknown;
    }): PluginRegistrationHandle {
        allow('ui.sidebar.register');
        if (!definition.id || !definition.label) invalid('Sidebar id and label are required');
        return toPluginHandle(
            runtime.api.registerSidebarPage({
                id: definition.id,
                label: definition.label,
                icon: definition.icon ?? SURFACE_ICON,
                order: definition.order,
                component: pluginComponent(definition.component),
            })
        );
    }

    function registerPane(definition: {
        id: string;
        label: string;
        icon?: string;
        order?: number;
        component?: unknown;
    }): PluginRegistrationHandle {
        allow('ui.pane.register');
        if (!definition.id || !definition.label) invalid('Pane id and label are required');
        return toPluginHandle(
            runtime.api.registerPaneApp({
                id: definition.id,
                label: definition.label,
                icon: definition.icon,
                order: definition.order,
                component: pluginComponent(definition.component),
            })
        );
    }

    function registerCard(definition: {
        id: string;
        title?: string;
        label?: string;
        order?: number;
    }): PluginRegistrationHandle {
        allowAny('ui.dashboard.register', ['ui.card.register']);
        if (!definition.id) invalid('Card id is required');
        return toPluginHandle(
            runtime.api.registerDashboardPlugin({
                id: definition.id,
                label: definition.title ?? definition.label ?? definition.id,
                icon: SURFACE_ICON,
                order: definition.order,
            })
        );
    }

    function registerMessageAction(definition: unknown): PluginRegistrationHandle {
        allow('ui.action.register');
        const record = asRecord(definition);
        if (!record || typeof record.id !== 'string') invalid('Message action id is required');
        const showOn = record.showOn;
        const action: ChatMessageAction =
            typeof record.handler === 'function' &&
            typeof record.icon === 'string' &&
            (showOn === 'user' || showOn === 'assistant' || showOn === 'both')
                ? {
                      id: record.id,
                      icon: record.icon,
                      tooltip:
                          typeof record.tooltip === 'string'
                              ? record.tooltip
                              : typeof record.label === 'string'
                                ? record.label
                                : record.id,
                      showOn,
                      ...(typeof record.order === 'number' ? { order: record.order } : {}),
                      handler: record.handler as ChatMessageAction['handler'],
                  }
                : {
                      id: record.id,
                      icon: typeof record.icon === 'string' ? record.icon : SURFACE_ICON,
                      tooltip: typeof record.label === 'string' ? record.label : record.id,
                      showOn: 'both',
                      ...(typeof record.order === 'number' ? { order: record.order } : {}),
                      handler: () => undefined,
                  };
        return toPluginHandle(runtime.api.registerMessageAction(action));
    }

    function registerCommand(
        definition: PluginCommandDefinition,
        handler: (
            invocation: { commandId: string; signal: AbortSignal }
        ) => PluginResult<PluginJsonValue> | Promise<PluginResult<PluginJsonValue>>,
        grant: PluginGrant | null = 'commands.register'
    ): PluginRegistrationHandle {
        if (grant) allow(grant);
        else live();
        if (!definition.id || !definition.label) invalid('Command id and label are required');
        return toPluginHandle(
            runtime.api.registerCommandPaletteCommand(
                {
                    id: definition.id,
                    label: definition.label,
                    description: definition.description,
                    keywords: definition.keywords ? [...definition.keywords] : undefined,
                    order: definition.order,
                    closeOnSuccess: definition.closeOnSuccess,
                },
                async () => {
                    const result = await handler({
                        commandId: definition.id,
                        signal: controller.signal,
                    });
                    if (result.ok) {
                        return { ok: true, closeOnSuccess: definition.closeOnSuccess };
                    }
                    return {
                        ok: false,
                        error: { code: 'execution-failed', message: result.error.message },
                    };
                }
            )
        );
    }

    function registerTool(
        definition: ExtendedToolDefinition,
        handler: ToolHandler
    ): PluginRegistrationHandle {
        allow('tools.register.client');
        if (!definition.function.name) invalid('Tool name is required');
        return toPluginHandle(runtime.api.registerTool(definition, handler));
    }

    function registerActivity(definition: unknown): PluginRegistrationHandle {
        allow('activity.register');
        const record = asRecord(definition);
        if (!record || typeof record.id !== 'string' || typeof record.label !== 'string') {
            invalid('Activity source id and label are required');
        }
        if (typeof record.list !== 'function') invalid('Activity source list is required');
        return toPluginHandle(
            runtime.api.registerActivitySource(
                definition as Parameters<Or3WorkspacePluginApi['registerActivitySource']>[0]
            )
        );
    }

    function registerPostSource(definition: unknown): PluginRegistrationHandle {
        allow('ui.command-palette.register');
        const record = asRecord(definition);
        if (
            !record ||
            typeof record.id !== 'string' ||
            typeof record.label !== 'string' ||
            typeof record.postType !== 'string' ||
            typeof record.categoryId !== 'string' ||
            !Array.isArray(record.filterAliases) ||
            !record.openTarget
        ) {
            invalid('Command palette post source is incomplete');
        }
        return toPluginHandle(
            runtime.api.registerCommandPalettePostSource(definition as PalettePostSourceDefinition)
        );
    }

    function trackListener(): PluginRegistrationHandle {
        allow('hooks.register');
        const entry: ListenerEntry = { disposed: false };
        listeners.push(entry);
        return {
            dispose() {
                entry.disposed = true;
            },
        };
    }

    const hooks: PluginHooks = {
        onAction() {
            return trackListener();
        },
        onFilter() {
            return trackListener();
        },
    };

    function registerContribution(contribution: PluginContribution): PluginRegistrationHandle {
        live();
        const kind: PluginContributionKind = contribution.kind;
        switch (kind) {
            case 'ui.dashboard.card':
                return registerCard(asRecord(contribution.definition) as { id: string; title?: string });
            case 'ui.sidebar.section': {
                const record = asRecord(contribution.definition);
                if (!record || typeof record.id !== 'string' || typeof record.label !== 'string') {
                    invalid('Sidebar contribution id and label are required');
                }
                return registerSidebar({
                    id: record.id,
                    label: record.label,
                    icon: typeof record.icon === 'string' ? record.icon : undefined,
                    order: typeof record.order === 'number' ? record.order : undefined,
                });
            }
            case 'ui.pane.app': {
                const record = asRecord(contribution.definition);
                if (!record || typeof record.id !== 'string' || typeof record.label !== 'string') {
                    invalid('Pane contribution id and label are required');
                }
                return registerPane({
                    id: record.id,
                    label: record.label,
                    icon: typeof record.icon === 'string' ? record.icon : undefined,
                    order: typeof record.order === 'number' ? record.order : undefined,
                });
            }
            case 'ui.command-palette.post-source':
                return registerPostSource(contribution.definition);
            case 'ui.command-palette.command': {
                const record = asRecord(contribution.definition);
                if (!record || typeof record.id !== 'string' || typeof record.label !== 'string') {
                    invalid('Command contribution id and label are required');
                }
                return registerCommand(
                    {
                        id: record.id,
                        label: record.label,
                        description:
                            typeof record.description === 'string' ? record.description : undefined,
                    },
                    () => pluginOk(null)
                );
            }
            case 'chat.action':
                return registerMessageAction(contribution.definition);
            case 'chat.tool.client': {
                const record = asRecord(contribution.definition);
                const fn = record ? asRecord(record.function) : null;
                if (!fn || typeof fn.name !== 'string' || fn.name.length === 0) {
                    invalid('Tool contribution name is required');
                }
                return registerTool(contribution.definition as ExtendedToolDefinition, async () => '{}');
            }
            case 'chat.tool.server':
            case 'editor.extension':
                return unsupported(`${kind} must be registered through context editor.register`);
            case 'editor.inspector.panel':
            case 'document.ai.action':
            case 'admin.extension':
                return unsupported(`${kind} is not available on the trusted host context`);
            default: {
                const unreachable: never = kind;
                return unsupported(`Unknown contribution ${String(unreachable)}`);
            }
        }
    }

    const mediation = createTrustedMediation({
        fetch: input.mediation?.fetch,
        approvedDestinations: input.mediation?.approvedDestinations,
        secrets: input.mediation?.secrets,
        files: input.mediation?.files,
        posts: input.mediation?.posts,
        ended,
        allow,
    });

    function bindDispose(dispose: () => void): PluginRegistrationHandle {
        runtime.api.onCleanup(dispose);
        return { dispose };
    }

    function registerModel(model: TrustedModelContribution): PluginRegistrationHandle {
        allow('tools.model.register');
        return bindDispose(registerTrustedExecutionModel(model).dispose);
    }

    function registerEditor(entry: TrustedEditorExtensionInput): PluginRegistrationHandle {
        allow('chat.editor.extension');
        return bindDispose(registerTrustedEditorExtension(entry).dispose);
    }

    function registerRenderer(definition: MessageRendererDefinition): PluginRegistrationHandle {
        allow('chat.message.renderer');
        const handle = registerMessageRenderer(definition);
        return bindDispose(() => {
            handle.dispose();
        });
    }

    const workspaceId = input.workspaceId ?? 'local';
    const fallback = createUnsupportedPluginClients({ workspaceId });
    const available = new Set(input.features ?? ['or3-trusted-host-v1']);

    const context = createHostPluginContext({
        identity: {
            pluginId: input.pluginId,
            version: input.version,
            workspaceId,
            generation: input.generation ?? 1,
            trust: 'trusted-host',
        },
        grants: input.grants ?? [],
        signal: controller.signal,
        logger: createLogger(input.pluginId),
        features: {
            has: (feature) => available.has(feature),
            require(feature) {
                if (!available.has(feature)) {
                    throw new Error(`Feature "${feature}" is not available`);
                }
            },
            optional: (feature) => available.has(feature),
            available,
        },
        hooks,
        contributions: {
            register: registerContribution,
        },
        clients: {
            createSettingsClient(_scope: HostPluginScope) {
                return settings;
            },
            createStorageClient(_scope: HostPluginScope) {
                return storage;
            },
            createClients() {
                return {
                    ...fallback,
                    ui: {
                        registerSidebar,
                        registerPane,
                        registerCard: (definition) => registerCard(definition),
                        registerAction: (definition) => {
                            if (definition.surface === 'message' || definition.surface === 'chat') {
                                return registerMessageAction(definition);
                            }
                            allow('ui.action.register');
                            return registerCommand(
                                { id: definition.id, label: definition.label, order: definition.order },
                                () => pluginOk(null),
                                null
                            );
                        },
                        toast: () => {
                            allow('ui.toast');
                            return pluginError('unsupported', 'ui.toast is not available on the trusted host context');
                        },
                        confirm: async () => {
                            allow('ui.confirm');
                            return pluginError('unsupported', 'ui.confirm is not available on the trusted host context');
                        },
                        progress: () => {
                            allow('ui.progress');
                            return pluginError('unsupported', 'ui.progress is not available on the trusted host context');
                        },
                    },
                    panes: {
                        async open(raw) {
                            allow('panes.open');
                            const validated = validatePluginPaneOpenInput(raw);
                            if (!validated.ok) return pluginError('invalid-input', validated.message);
                            const api = getGlobalMultiPaneApi();
                            if (!api) {
                                return pluginError('host-unavailable', 'Workspace panes are not available');
                            }
                            const target = validated.value.target ?? 'focus-or-new';
                            const existing = api.panes.value.findIndex(
                                (pane) => pane.mode === validated.value.app
                            );
                            if (target !== 'new' && existing >= 0) {
                                api.setActive(existing);
                            } else if (target === 'replace-active') {
                                await api.setPaneApp(api.activePaneIndex.value, validated.value.app);
                            } else {
                                await api.newPaneForApp(validated.value.app);
                            }
                            const pane =
                                api.panes.value.find((entry) => entry.mode === validated.value.app) ??
                                api.panes.value[api.activePaneIndex.value];
                            if (!pane) return pluginError('not-found', 'Pane was not opened');
                            return pluginOk({
                                id: pane.id,
                                app: validated.value.app,
                                instanceKey: validated.value.instanceKey ?? input.pluginId,
                            });
                        },
                        async focus(id) {
                            allow('panes.open');
                            const api = getGlobalMultiPaneApi();
                            if (!api) {
                                return pluginError('host-unavailable', 'Workspace panes are not available');
                            }
                            const index = api.getPaneIndexById(id);
                            if (index < 0) return pluginError('not-found', 'Pane was not found');
                            api.setActive(index);
                            return pluginOk(undefined);
                        },
                        async close(id) {
                            allow('panes.open');
                            const api = getGlobalMultiPaneApi();
                            if (!api) {
                                return pluginError('host-unavailable', 'Workspace panes are not available');
                            }
                            const index = api.getPaneIndexById(id);
                            if (index < 0) return pluginError('not-found', 'Pane was not found');
                            await api.closePane(index);
                            return pluginOk(undefined);
                        },
                    },
                    commands: {
                        register: registerCommand,
                        async run() {
                            allow('commands.run.public');
                            return pluginError(
                                'unsupported',
                                'commands.run is not available on the trusted host context'
                            );
                        },
                    },
                    activity: {
                        registerSource: (source) => registerActivity(source),
                    },
                    network: mediation.network,
                    secrets: mediation.secrets,
                    files: mediation.files,
                };
            },
        },
        onCleanup(callback) {
            if (ended()) return;
            runtime.api.onCleanup(callback);
        },
        onActivate(callback) {
            if (ended()) return;
            activations.push(callback);
        },
    });

    return {
        context,
        tools: { register: registerTool, registerModel },
        editor: {
            register: registerEditor,
            applyExtensions: applyTrustedEditorExtensions,
            handleBeforeSend: interceptTrustedEditorSend,
        },
        posts: mediation.posts,
        renderers: { register: registerRenderer },
        workspaceApi: runtime.api,
        get liveListenerCount() {
            if (closed) return 0;
            return listeners.filter((entry) => !entry.disposed).length;
        },
        dispose(reason) {
            if (!closed) {
                closed = true;
                for (const entry of listeners) entry.disposed = true;
                listeners.length = 0;
                activations.length = 0;
                settings.clear();
                storage.clear();
                if (!controller.signal.aborted) controller.abort(reason);
            }
            return runtime.dispose(reason);
        },
    };
}
