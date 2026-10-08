import { getWorkspaceResourceNavigationApi } from '~/utils/workspaceResourceNavigation';
import { defineComponent, h, watch, type Component } from 'vue';
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
    type PluginWorkspaceChange,
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
    PluginHookOptions,
    PluginLogger,
} from '@or3/plugin-sdk';
import type { PluginSettingsClient, PluginStorageClient, PluginStorageRecord } from '@or3/plugin-sdk';
import { getDb, getWorkspaceGeneration } from '~/db/client';
import { createTrustedWorkspaceStorage } from './trusted-workspace-storage';
import { createTrustedRecords } from './trusted-records';
import { createTrustedWorkspaceFiles } from './trusted-workspace-files';
import { createTrustedNetworkAccess } from './trusted-network-access';
import type { createTrustedRuntimeServices } from './trusted-runtime-services';
import { markChatSendHandled } from '~/utils/chat/send-interception';
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
    'ui.workspace-profile.register', 'ai.provider', 'tools.use', 'jobs.background', 'hooks.emit',
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
    'chat.tool.card',
    'chat.tool.card.embed',
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
    'files.catalog.read',
    'files.catalog.write',
    'files.actions.register',
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
    readonly signal?: AbortSignal;
    readonly version: string;
    readonly workspaceId?: string;
    readonly generation?: number;
    readonly grants?: readonly PluginGrant[];
    readonly features?: readonly string[];
    readonly subscribeWorkspaceChanges?: (
        listener: (change: PluginWorkspaceChange) => void | Promise<void>
    ) => PluginRegistrationHandle;
    readonly subscribeHook?: (
        name: string,
        kind: 'action' | 'filter',
        callback: (...args: unknown[]) => unknown,
        options?: { readonly priority?: number; readonly signal?: AbortSignal }
    ) => () => void;
    readonly settingDefaults?: Readonly<Record<string, PluginJsonValue>>;
    readonly requestedFeatures?: readonly string[];
    readonly runtimeServices?: (authority: { pluginId: string; db: ReturnType<typeof getDb>; allow(grant: PluginGrant): void; current(): boolean; cleanup(callback: () => void): void }) => ReturnType<typeof createTrustedRuntimeServices>;
    readonly emitHook?: (name: string, payload: unknown) => Promise<void>;
    readonly mediation?: Pick<
        TrustedMediationOptions,
        'fetch' | 'approvedDestinations' | 'authorizeDestination' | 'secrets' | 'files' | 'posts' | 'limits'
    >;
}

export interface TrustedHostContext {
    readonly context: PluginContext;
    /** Trusted execution-model registrations; SDK tools expose list/execute. */
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
    stop: () => void;
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
    const abort = () => controller.abort(input.signal?.reason);
    input.signal?.addEventListener('abort', abort, { once: true });
    if (input.signal?.aborted) abort();
    runtime.api.onCleanup(() =>
        input.signal?.removeEventListener('abort', abort)
    );
    const granted = new Set<PluginGrant>(input.grants ?? []);
    const listeners: ListenerEntry[] = [];
    const activations: Array<() => void | Promise<void>> = [];
    let closed = false;
    const activationDb = getDb();
    const workspaceGeneration = getWorkspaceGeneration();
    const ended = () => closed || controller.signal.aborted || getDb() !== activationDb || getWorkspaceGeneration() !== workspaceGeneration;
    const postTypes = new Set<string>();
    const messageTypes = new Set<string>();
    let beforeSendDepth = 0;
    const cleanup = (callback: () => void) => runtime.api.onCleanup(callback);
    const services = input.runtimeServices?.({ pluginId: input.pluginId, db: activationDb, allow, current: () => !ended(), cleanup });
    const { settings, storage } = createTrustedWorkspaceStorage({ pluginId: input.pluginId, db: activationDb, grants: granted, ended, defaults: { ...services?.settingDefaults, ...input.settingDefaults } });
    const records = createTrustedRecords({ db: activationDb, allow, postTypes, messageTypes, inBeforeSend: () => beforeSendDepth > 0, current: () => !ended(), cleanup });
    const workspaceFiles = createTrustedWorkspaceFiles({ pluginId: input.pluginId,
        workspaceId: input.workspaceId ?? 'local', db: activationDb, signal: controller.signal,
        allow, current: () => !ended(), cleanup });
    const access = createTrustedNetworkAccess({ pluginId: input.pluginId, db: activationDb, current: () => !ended(), hostOrigin: globalThis.location?.origin ?? 'https://localhost', destinations: input.mediation?.approvedDestinations,
        confirm: (origins, purpose) => services?.confirmOrigins(origins, purpose) ?? Promise.resolve(false),
        connectOrigins: async () => { if (!granted.has('workspace.connections.read') || !services) return []; const result = await services.connections.list(); return result.ok ? result.value.flatMap(row => row.baseUrl ? [row.baseUrl] : []) : []; },
    });

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
        description?: string;
        keepAlive?: boolean;
        usesDefaultHeader?: boolean;
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
                description: definition.description,
                keepAlive: definition.keepAlive,
                usesDefaultHeader: definition.usesDefaultHeader,
                component: pluginComponent(definition.component),
            })
        );
    }

    function registerPane(definition: {
        id: string;
        label: string;
        icon?: string;
        order?: number;
        postType?: string;
        createInitialRecord?: () => Promise<{ readonly id: string } | null>;
        newTab?: {
            readonly label: string;
            readonly icon?: string;
            readonly isAvailable?: () => boolean;
            readonly createRecordId: () => Promise<string | null>;
        };
        component?: unknown;
    }): PluginRegistrationHandle {
        allow('ui.pane.register');
        if (!definition.id || !definition.label) invalid('Pane id and label are required');
        if (definition.postType) postTypes.add(definition.postType);
        const handle = toPluginHandle(
            runtime.api.registerPaneApp({
                id: definition.id,
                label: definition.label,
                icon: definition.icon,
                order: definition.order,
                postType: definition.postType,
                createInitialRecord: definition.createInitialRecord,
                newTab: definition.newTab,
                component: pluginComponent(definition.component),
            })
        );
        return { dispose() { handle.dispose(); if (definition.postType) postTypes.delete(definition.postType); } };
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

    function trackListener(stop: () => void = () => {}): PluginRegistrationHandle {
        allow('hooks.register');
        const entry: ListenerEntry = { disposed: false, stop };
        listeners.push(entry);
        const handle = {
            dispose() {
                if (entry.disposed) return;
                entry.disposed = true;
                stop();
            },
        };
        runtime.api.onCleanup(() => handle.dispose());
        return handle;
    }

    const approvedActionHooks = new Set([
        'workspace.files:action:before',
        'workspace.files:action:after',
        'ui.chat.editor:action:before_send',
        'ai.chat.send:action:before',
        'workflow.execution:action:state_update',
    ]);
    const approvedFilterHooks = new Set(['workspace.files:filter:policy', 'ai.chat.messages:filter:before_send',
        'ai.chat.send:filter:prepare', 'ai.chat.send:filter:commit']);
    function subscribeHook(
        name: string,
        kind: 'action' | 'filter',
        callback: (...args: unknown[]) => unknown,
        options?: { readonly priority?: number; readonly signal?: AbortSignal }
    ): PluginRegistrationHandle {
        allow('hooks.register');
        const fileHook = name.startsWith('workspace.files:');
        if (fileHook) {
            // Grants only: workspace access is checked on delivery, so read-only
            // members and hosts without Files can still activate the plugin.
            allow(kind === 'filter' ? 'files.catalog.write' : 'files.catalog.read');
            if (!input.subscribeHook) unsupported('Workspace file hook delivery is unavailable');
        }
        // Bundled V1 keeps its legacy lifecycle-only hook handle. Runtime V2
        // receives only the reviewed chat, workflow and workspace file hooks.
        if (!input.subscribeHook) return trackListener();
        const approved = kind === 'action' ? approvedActionHooks : approvedFilterHooks;
        if (!approved.has(name)) unsupported(`Hook ${name} is not available to plugins`);
        const wrapped = (...args: unknown[]) => {
            if (fileHook) {
                const event = args[kind === 'filter' ? 1 : 0] as { workspaceId?: string } | undefined;
                if (event?.workspaceId !== (input.workspaceId ?? 'local') || (kind === 'filter' && args[0] === false)) {
                    return kind === 'filter' ? args[0] : undefined;
                }
                if (kind === 'filter') {
                    // The hook engine keeps the previous value when a callback throws,
                    // so a failing or non-boolean policy refuses the change here.
                    try {
                        workspaceFiles.assertAccess(true);
                        live();
                        return Promise.resolve(callback(...args)).then(allowed => allowed === true, () => false);
                    } catch {
                        return false;
                    }
                }
                workspaceFiles.assertAccess();
            }
            live();
            if (!['ui.chat.editor:action:before_send', 'ai.chat.send:action:before', 'ai.chat.messages:filter:before_send', 'ai.chat.send:filter:prepare', 'ai.chat.send:filter:commit'].includes(name)) return callback(...args);
            beforeSendDepth += 1;
            try { const result = callback(...args); if (result instanceof Promise) return result.finally(() => { beforeSendDepth -= 1; }); beforeSendDepth -= 1; return result; }
            catch (error) { beforeSendDepth -= 1; throw error; }
        };
        return trackListener(input.subscribeHook(name, kind, wrapped, options));
    }

    const hooks: PluginHooks = {
        async emitAction(name, payload) {
            allow('hooks.emit');
            if (!['workflow.execution:action:start', 'workflow.execution:action:state_update', 'workflow.execution:action:node_complete', 'workflow.execution:action:complete'].includes(name)) return pluginError('permission-denied', 'Hook emission is not approved');
            if (!input.emitHook) return pluginError('unsupported', 'Host hook emission is unavailable');
            await input.emitHook(name, payload); return pluginOk(undefined);
        },
        onAction<TArgs extends readonly unknown[]>(name: string, callback: (...args: TArgs) => void | Promise<void>, options?: PluginHookOptions) {
            return subscribeHook(name, 'action', callback as unknown as (...args: unknown[]) => unknown, options);
        },
        onFilter<TValue, TArgs extends readonly unknown[]>(name: string, callback: (value: TValue, ...args: TArgs) => TValue | Promise<TValue>, options?: PluginHookOptions) {
            return subscribeHook(name, 'filter', callback as (...args: unknown[]) => unknown, options);
        },
    };

    function registerContribution(
        contribution: PluginContribution
    ): PluginRegistrationHandle {
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
            case 'chat.message.renderer': {
                allow('chat.message.renderer');
                const definition = asRecord(contribution.definition);
                if (!definition || typeof definition.match !== 'function' ||
                    (!asRecord(definition.component) && typeof definition.component !== 'function')) {
                    invalid('A message renderer requires a matcher and Vue component');
                }
                return registerRenderer({ ...definition, id: contribution.id } as unknown as MessageRendererDefinition);
            }
            case 'chat.tool.card':
                allow('chat.tool.card');
                return toPluginHandle(
                    runtime.api.registerToolCard(
                        contribution.definition as import('@or3/plugin-sdk/cards').PluginToolCardDefinition
                    )
                );
            case 'chat.tool.client': {
                const record = asRecord(contribution.definition);
                const fn = record ? asRecord(record.function) : null;
                if (!fn || typeof fn.name !== 'string' || fn.name.length === 0) {
                    invalid('Tool contribution name is required');
                }
                return registerTool(contribution.definition as ExtendedToolDefinition, async () => '{}');
            }
            case 'editor.extension': {
                allow('chat.editor.extension');
                const definition = asRecord(contribution.definition);
                if (!definition || !asRecord(definition.extension)) {
                    invalid('An editor contribution requires an extension object');
                }
                return registerEditor({ ...definition, id: contribution.id } as unknown as TrustedEditorExtensionInput);
            }
            case 'chat.tool.server':
                return unsupported(`${kind} is not available on the trusted host context`);
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

    runtime.api.onCleanup(() => records.releaseFiles());
    const mediation = createTrustedMediation({
        retainFile: records.retainFile,
        signal: controller.signal,
        fetch: input.mediation?.fetch,
        approvedDestinations: input.mediation?.approvedDestinations,
        authorizeDestination: input.mediation?.authorizeDestination ?? access.authorize,
        pluginId: input.pluginId,
        limits: services?.limits ?? input.mediation?.limits,
        requestAccess: async (value) => { allow('network.http'); return access.requestAccess(value); },
        revokeAccess: async (value) => { allow('network.http'); return access.revokeAccess(value); },
        ownOrigin: globalThis.location?.origin,
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
        const type = (definition as MessageRendererDefinition & { messageType?: string }).messageType;
        if (type) messageTypes.add(type);
        const handle = registerMessageRenderer(definition);
        return bindDispose(() => {
            handle.dispose();
            if (type) messageTypes.delete(type);
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
                    events: {
                        on(name, listener) {
                            allow('workspace.connections.read');
                            if (name !== 'connections.changed') return unsupported('Only connections.changed is supported here');
                            const callback = (event: Event) => { if (!ended()) void listener((event as CustomEvent).detail); };
                            window.addEventListener(name, callback);
                            const dispose = () => window.removeEventListener(name, callback); cleanup(dispose); return { dispose };
                        },
                    },
                    posts: records.posts,
                    ai: services?.ai ?? fallback.ai,
                    tools: services?.tools ?? fallback.tools,
                    jobs: services?.jobs ?? fallback.jobs,
                    chat: {
                        ...fallback.chat,
                        registerToolCard(
                            definition: import('@or3/plugin-sdk/cards').PluginToolCardDefinition
                        ) {
                            allow('chat.tool.card');
                            return toPluginHandle(
                                runtime.api.registerToolCard(definition)
                            );
                        },
                        messages: records.messages,
                        composer: {
                            prefill:
                                services?.prefill ??
                                fallback.chat.composer.prefill,
                        },
                        send: { markHandled() { allow('chat.editor.extension'); if (!beforeSendDepth) return pluginError('permission-denied', 'markHandled requires an approved before-send callback'); markChatSendHandled(); return pluginOk(undefined); } },
                    },
                    ui: {
                        ...fallback.ui,
                        kit: available.has('or3-trusted-ui-kit-v1') && input.requestedFeatures?.includes('or3-trusted-ui-kit-v1') ? services?.kit : undefined,
                        sidebar: services?.sidebar ?? fallback.ui.sidebar,
                        registerWorkspaceProfile: services?.registerProfile ?? fallback.ui.registerWorkspaceProfile,
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
                        toast: services?.toast ?? fallback.ui.toast,
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
                        async list() { allow('panes.open'); const api = getGlobalMultiPaneApi(); if (!api) return pluginError('host-unavailable', 'Workspace panes unavailable'); return pluginOk(api.panes.value.map((pane, index) => ({ id: pane.id, app: pane.mode, recordId: pane.documentId || pane.threadId || undefined, active: index === api.activePaneIndex.value }))); },
                        onChange(listener) { allow('panes.open'); const api = getGlobalMultiPaneApi(); if (!api) return unsupported('Workspace panes unavailable'); const stop = watch([api.panes, api.activePaneIndex], () => { if (!ended()) listener(api.panes.value.map((pane, index) => ({ id: pane.id, app: pane.mode, recordId: pane.documentId || pane.threadId || undefined, active: index === api.activePaneIndex.value }))); }, { deep: true }); cleanup(stop); return { dispose: stop }; },
                        async open(raw) {
                            allow('panes.open');
                            const validated = validatePluginPaneOpenInput(raw);
                            if (!validated.ok) return pluginError('invalid-input', validated.message);
                            const api = getGlobalMultiPaneApi();
                            if (!api) {
                                return pluginError('host-unavailable', 'Workspace panes are not available');
                            }
                            const target = validated.value.target ?? 'focus-or-new';
                            const data = asRecord(validated.value.data);
                            const recordId = typeof data?.recordId === 'string' ? data.recordId : undefined;
                            const existing = api.panes.value.findIndex(
                                (pane) => pane.mode === validated.value.app
                            );
                            if (validated.value.app === 'chat' || validated.value.app === 'doc') {
                                let index = typeof target === 'object' ? api.getPaneIndexById(target.pane) : api.activePaneIndex.value;
                                if (target === 'new') {
                                    const navigation = getWorkspaceResourceNavigationApi();
                                    if (!navigation || !await navigation.openResource(validated.value.app === 'chat' ? { kind: 'chat', threadId: recordId ?? null } : { kind: 'document', documentId: recordId ?? '' }, 'new-tab')) return pluginError('host-unavailable', 'Resource navigation unavailable');
                                    index = api.activePaneIndex.value;
                                }
                                if (index < 0) return pluginError('not-found', 'Target pane not found');
                                if (validated.value.app === 'chat') { api.updatePane(index, { mode: 'chat', documentId: undefined, messages: [], threadId: '' }); if (recordId) await api.setPaneThread(index, recordId); }
                                else { if (!recordId) return pluginError('invalid-input', 'Document ID required'); api.updatePane(index, { mode: 'doc', threadId: '', documentId: recordId, messages: [] }); }
                                api.setActive(index);
                            } else if (typeof target === 'object') {
                                const index = api.getPaneIndexById(target.pane);
                                if (index < 0) return pluginError('not-found', 'Target pane was not found');
                                await api.setPaneApp(index, validated.value.app, { recordId }); api.setActive(index);
                            } else if (target === 'replace-active') {
                                await api.setPaneApp(api.activePaneIndex.value, validated.value.app, { recordId });
                            } else if (target !== 'new' && existing >= 0) {
                                if (recordId) await api.setPaneApp(existing, validated.value.app, { recordId });
                                api.setActive(existing);
                            } else {
                                await api.newPaneForApp(validated.value.app, { initialRecordId: recordId });
                            }
                            const pane = api.panes.value[api.activePaneIndex.value];
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
                    workspace: {
                        ...fallback.workspace,
                        connections: services?.connections ?? fallback.workspace.connections,
                        id: input.workspaceId ?? 'local',
                        onChange(listener) {
                            allow('workspace.read');
                            if (!input.subscribeWorkspaceChanges) {
                                return unsupported('workspace.onChange is unavailable');
                            }
                            const handle = input.subscribeWorkspaceChanges(listener);
                            runtime.api.onCleanup(() => handle.dispose());
                            return handle;
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
                    http: mediation.http,
                    secrets: mediation.secrets,
                    files: { ...mediation.files, catalog: workspaceFiles.catalog, registerAction: workspaceFiles.registerAction },
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
                // Listener handles are registered with the managed runtime.
                // Its cleanup runs every handle even when one unsubscribe throws.
                listeners.length = 0;
                activations.length = 0;
                if (!controller.signal.aborted) controller.abort(reason);
            }
            return runtime.dispose(reason);
        },
    };
}
