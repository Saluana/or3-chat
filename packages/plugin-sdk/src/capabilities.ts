import type { PluginToolCardDefinition } from './cards';
import type { Component, Ref, ComputedRef } from 'vue';
import type {
    PluginJsonValue,
    PluginSettingsClient,
    PluginStorageClient,
} from './clients';
import type { PluginRegistrationHandle } from './contracts';
import type { PluginFileAction, PluginFilesCatalogClient } from './workspace-files';
import { pluginError } from './results';
import type { PluginError, PluginResult } from './results';

/** Stable events that cross the plugin boundary. Payloads are plain data. */
export const PLUGIN_EVENT_NAMES = [
    'workspace.changed',
    'settings.changed',
    'chat.created',
    'chat.message.created',
    'connections.changed',
    'host.resumed',
] as const;

export type PluginEventName = (typeof PLUGIN_EVENT_NAMES)[number];

export interface PluginWorkspaceChange {
    readonly previousId: string;
    readonly id: string;
    readonly reason: 'user' | 'restore' | 'host';
}

export interface PluginSettingsChange {
    readonly key: string;
    readonly revision: number;
    readonly deleted: boolean;
}

export interface PluginConnectionSummary {
    readonly id: string;
    readonly label: string;
    readonly provider: string;
    readonly status: 'configured' | 'missing' | 'locked' | 'unavailable';
    readonly capabilities: readonly string[];
    readonly baseUrl?: string;
    readonly credential?: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface PluginEventMap {
    'workspace.changed': PluginWorkspaceChange;
    'settings.changed': PluginSettingsChange;
    'chat.created': { readonly chatId: string; readonly title?: string };
    'chat.message.created': {
        readonly chatId: string;
        readonly messageId: string;
        readonly role: 'user' | 'assistant' | 'system' | 'tool';
    };
    'connections.changed': { readonly revision: number };
    'host.resumed': { readonly at: number };
}

export interface PluginEventsClient {
    on<K extends PluginEventName>(
        name: K,
        listener: (payload: PluginEventMap[K]) => void | Promise<void>
    ): PluginRegistrationHandle;
}

export interface PluginWorkspaceClient {
    readonly id: string;
    onChange(
        listener: (change: PluginWorkspaceChange) => void | Promise<void>
    ): PluginRegistrationHandle;
    switch(id: string): Promise<PluginResult<{ readonly id: string }>>;
    connections: {
        status(): Promise<PluginResult<{ enabled: boolean; pairingUrl?: string }>>;
        remove(id: string): Promise<PluginResult<void>>;
        list(): Promise<PluginResult<readonly PluginConnectionSummary[]>>;
        manage(id: string): Promise<PluginResult<void>>;
    };
}

export type PluginUiSurface = 'sidebar' | 'pane' | 'card' | 'action';

export interface PluginSidebarDefinition {
    readonly id: string;
    readonly label: string;
    readonly icon?: string;
    readonly order?: number;
    readonly description?: string;
    readonly keepAlive?: boolean;
    readonly usesDefaultHeader?: boolean;
    /** Host Vue component. Omitted registrations render a placeholder. */
    readonly component?: unknown;
}

export interface PluginPaneDefinition {
    readonly id: string;
    readonly label: string;
    readonly icon?: string;
    readonly order?: number;
    readonly dataVersion?: number;
    readonly postType?: string;
    readonly createInitialRecord?: () => Promise<{ readonly id: string } | null>;
    readonly newTab?: {
        readonly label: string;
        readonly icon?: string;
        readonly isAvailable?: () => boolean;
        readonly createRecordId: () => Promise<string | null>;
    };
    /** Host Vue component. Omitted registrations render a placeholder. */
    readonly component?: unknown;
}

export interface PluginCardDefinition {
    readonly id: string;
    readonly title: string;
    readonly order?: number;
}

export interface PluginActionDefinition {
    readonly id: string;
    readonly label: string;
    readonly surface: 'sidebar' | 'pane' | 'chat' | 'message';
    readonly order?: number;
}

export interface PluginToastInput {
    readonly message: string;
    readonly description?: string;
    readonly tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
    readonly durationMs?: number;
}

export interface PluginConfirmInput {
    readonly title: string;
    readonly message: string;
    readonly confirmLabel?: string;
    readonly cancelLabel?: string;
    readonly tone?: 'neutral' | 'danger';
}

export interface PluginProgressHandle extends PluginRegistrationHandle {
    update(input: { readonly value?: number; readonly label?: string }): PluginResult<void>;
}

export interface PluginTrustedUiKitV1 {
    readonly components: Readonly<Record<'UAlert' | 'UBadge' | 'UButton' | 'UCheckbox' | 'UDropdownMenu' | 'UFieldGroup' | 'UIcon' | 'UInput' | 'UModal' | 'UPopover' | 'USelectMenu' | 'UTabs' | 'UTextarea' | 'UTooltip' | 'ChatComposerShell' | 'MessageAttachmentsGallery' | 'StreamMarkdown' | 'Scroll' | 'SidebarEmptyState' | 'SidebarGroupHeader', Component> & { ChatMessage: ComputedRef<Component> }>;
    icon(token: string): ComputedRef<string>;
    readonly theme: { readonly active: Ref<string>; readonly activeComponents: Ref<Record<string, Component>>; getTheme(name: string): { customComponents?: Record<string, string> } | null; overrides(input: { component: string; context: string; identifier: string; isNuxtUI: boolean }): Ref<Record<string, unknown>> };
    chatInputTheme(closeIcon: Ref<string>): Readonly<Record<'sendButtonProps' | 'stopButtonProps' | 'attachButtonProps' | 'settingsButtonProps' | 'mainContainerProps' | 'dragOverlayProps', Ref<Record<string, unknown>>>>;
    readonly responsive: { readonly isMobile: Ref<boolean> };
    highlighter(): Promise<unknown>;
}
export interface PluginUiClient {
    readonly kit?: PluginTrustedUiKitV1;
    readonly sidebar: { show(pageId: string): Promise<PluginResult<void>>; closeIfMobile(): PluginResult<void> };
    registerWorkspaceProfile(profile: unknown): PluginRegistrationHandle;
    registerSidebar(definition: PluginSidebarDefinition): PluginRegistrationHandle;
    registerPane(definition: PluginPaneDefinition): PluginRegistrationHandle;
    registerCard(definition: PluginCardDefinition): PluginRegistrationHandle;
    registerAction(definition: PluginActionDefinition): PluginRegistrationHandle;
    toast(input: PluginToastInput): PluginResult<void>;
    confirm(input: PluginConfirmInput): Promise<PluginResult<boolean>>;
    progress(input: { readonly label: string; readonly max?: number }): PluginResult<PluginProgressHandle>;
}

export type PluginPaneTarget = 'focus-or-new' | 'new' | 'replace-active' | { readonly pane: string };

export interface PluginPaneOpenInput {
    readonly app: string;
    readonly data: PluginJsonValue;
    readonly instanceKey?: string;
    readonly target?: PluginPaneTarget;
}

export interface PluginPaneRef {
    readonly id: string;
    readonly app: string;
    readonly instanceKey: string;
}

export interface PluginPaneSummary { readonly id: string; readonly app: string; readonly recordId?: string; readonly active: boolean }
export interface PluginPanesClient {
    list(): Promise<PluginResult<readonly PluginPaneSummary[]>>;
    onChange(listener: (panes: readonly PluginPaneSummary[]) => void): PluginRegistrationHandle;
    open(input: PluginPaneOpenInput): Promise<PluginResult<PluginPaneRef>>;
    focus(id: string): Promise<PluginResult<void>>;
    close(id: string): Promise<PluginResult<void>>;
}

export interface PluginCommandDefinition {
    readonly id: string;
    readonly label: string;
    readonly description?: string;
    readonly keywords?: readonly string[];
    readonly order?: number;
    readonly closeOnSuccess?: boolean;
}

export interface PluginCommandInvocation {
    readonly commandId: string;
    readonly signal: AbortSignal;
    readonly data?: PluginJsonValue;
}

export type PluginCommandHandler = (
    invocation: PluginCommandInvocation
) => PluginResult<PluginJsonValue> | Promise<PluginResult<PluginJsonValue>>;

export interface PluginCommandsClient {
    register(
        definition: PluginCommandDefinition,
        handler: PluginCommandHandler
    ): PluginRegistrationHandle;
    run(
        commandId: string,
        data?: PluginJsonValue
    ): Promise<PluginResult<PluginJsonValue>>;
}

export interface PluginModelInfo {
    readonly id: string;
    readonly label: string;
    readonly priced: boolean;
    readonly favorite?: boolean;
    readonly metadata?: Readonly<Record<string, unknown>>;
    readonly promptPerMillion?: number | null;
    readonly completionPerMillion?: number | null;
}

export interface PluginModelCatalog {
    readonly configured: boolean;
    readonly models: readonly PluginModelInfo[];
    readonly limits: {
        readonly maxOutputTokens: number;
        readonly spendLimitUsd: number;
        readonly maxConcurrentCalls: number;
        readonly deadlineMs: number;
    };
}

export interface PluginCompletion {
    readonly text: string;
    readonly model: string;
    readonly usage: {
        readonly promptTokens: number;
        readonly completionTokens: number;
        readonly spendUsd: number;
    };
}

export interface PluginAiClient {
    provider(): Promise<PluginResult<{ readonly client: unknown; readonly apiKey: string; readonly headers: Readonly<Record<string, string>> }>>;
    requestSignIn(): PluginResult<void>;
    onModelsChange(listener: () => void): PluginRegistrationHandle;
    models(): Promise<PluginResult<PluginModelCatalog>>;
    complete(input: {
        readonly model: string;
        readonly prompt: string;
        readonly maxOutputTokens?: number;
    }): Promise<PluginResult<PluginCompletion>>;
}

export interface PluginSecretRef {
    readonly id: string;
    readonly revision: number;
    readonly owner?: 'plugin' | 'connection';
    readonly persistence?: 'memory' | 'session' | 'persistent';
    readonly state?: PluginSecretState;
}

export type PluginSecretState = 'available' | 'missing' | 'locked' | 'unavailable';

export interface PluginSecretsClient {
    get(key: string): Promise<PluginResult<string | null>>;
    set(
        key: string,
        value: string,
        options?: { readonly persistence?: 'session' | 'remember' }
    ): Promise<PluginResult<void>>;
    delete(key: string): Promise<PluginResult<void>>;
    ref(key: string): Promise<PluginResult<PluginSecretRef>>;
    status(key?: string): Promise<PluginResult<PluginSecretState>>;
    unlock(): Promise<PluginResult<void>>;
}

export interface PluginFileRef {
    readonly id: string;
    readonly name: string;
    readonly mimeType: string;
    readonly size: number;
    readonly revision?: number;
    readonly origin?: 'picker' | 'attachment' | 'generated';
}

export interface PluginFileRead extends AsyncIterable<Uint8Array> {
    readonly result: Promise<PluginResult<void>>;
    cancel(): void;
}

export interface PluginFilesClient {
    readonly catalog: PluginFilesCatalogClient;
    registerAction(action: PluginFileAction): PluginRegistrationHandle;
    limits(): Promise<PluginResult<{ maxFilesPerMessage: number; maxFileSizeBytes: number }>>;
    pick(options?: {
        readonly multiple?: boolean;
        readonly accept?: readonly string[];
        readonly signal?: AbortSignal;
    }): Promise<PluginResult<readonly PluginFileRef[]>>;
    read(id: string, options?: { readonly signal?: AbortSignal }): Promise<PluginResult<PluginFileRead>>;
    write(input: {
        readonly name: string;
        readonly mimeType: string;
        readonly data: AsyncIterable<Uint8Array>;
        readonly replace?: { readonly id: string; readonly ifRevision: number };
        readonly signal?: AbortSignal;
    }): Promise<PluginResult<PluginFileRef>>;
}

export type PluginHttpBody =
    | string
    | Uint8Array
    | PluginJsonValue
    | { readonly kind: 'multipart'; readonly fields: Readonly<Record<string, string>>; readonly files: readonly PluginFileRef[]; readonly parts?: readonly { name: string; filename: string; mimeType: string; data: Uint8Array }[] };

export interface PluginHttpResponse {
    readonly status: number;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string | Uint8Array;
}

export interface PluginHttpClient {
    fetch(input: {
        readonly url: string;
        readonly destination: string;
        readonly method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
        readonly headers?: Readonly<Record<string, string>>;
        readonly body?: PluginHttpBody;
        readonly signal?: AbortSignal;
    }): Promise<PluginResult<PluginHttpResponse>>;
    /** Compatibility spelling for existing V2 fixtures; it is still host-mediated. */
    request(input: {
        readonly url: string;
        readonly destination?: string;
        readonly method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
        readonly headers?: Readonly<Record<string, string>>;
        readonly body?: PluginHttpBody;
        readonly signal?: AbortSignal;
    }): Promise<PluginResult<PluginHttpResponse>>;
}

export interface PluginStreamChunk {
    readonly kind: 'data' | 'comment' | 'error';
    readonly data: string | Uint8Array;
    readonly id?: string;
    readonly event?: string;
}

export interface PluginStream {
    readonly chunks: AsyncIterable<PluginStreamChunk>;
    readonly result: Promise<PluginResult<void>>;
    cancel(): void;
}

export interface PluginNetworkClient {
    requestAccess(input: { readonly origins: readonly string[]; readonly purpose: string }): Promise<PluginResult<{ readonly approved: readonly string[] }>>;
    revokeAccess(origin: string): Promise<PluginResult<void>>;
    stream(input: {
        readonly url: string;
        readonly destination: string;
        readonly format: 'sse' | 'bytes';
        readonly method?: 'GET' | 'POST';
        readonly headers?: Readonly<Record<string, string>>;
        readonly body?: PluginHttpBody;
        readonly signal?: AbortSignal;
        readonly reconnect?: false | { readonly maxAttempts: number; readonly resume: 'last-event-id' };
    }): Promise<PluginResult<PluginStream>>;
}

export interface PluginChatMessage {
    readonly role: 'user' | 'assistant' | 'system' | 'tool';
    readonly content: string;
    readonly fileIds?: readonly string[];
    readonly attachments?: readonly {
        readonly fileId: string;
        readonly name?: string;
        readonly mimeType?: string;
        readonly state?: 'pending' | 'ready' | 'failed';
    }[];
}

export interface PluginChatRef {
    readonly id: string;
    readonly title?: string;
}

export interface PluginChatClient {
    registerToolCard(
        definition: PluginToolCardDefinition
    ): PluginRegistrationHandle;
    readonly messages: PluginMessagesClient;
    readonly composer: { prefill(text: string, paneId?: string): Promise<PluginResult<void>> };
    readonly send: { markHandled(): PluginResult<void> };
    create(input?: { readonly title?: string }): Promise<PluginResult<PluginChatRef>>;
    open(id: string): Promise<PluginResult<PluginChatRef>>;
    appendMessage(
        chatId: string,
        message: PluginChatMessage,
        options?: { readonly requestId?: string }
    ): Promise<PluginResult<{ readonly messageId: string }>>;
}

export type PluginActivityStatus =
    | 'queued'
    | 'running'
    | 'waiting_approval'
    | 'succeeded'
    | 'failed'
    | 'cancelled';

export type PluginActivityAction =
    | 'cancel'
    | 'retry'
    | 'approve'
    | 'deny'
    | 'open-source';

export type PluginActivityEventType =
    | 'status'
    | 'message'
    | 'tool'
    | 'approval'
    | 'artifact'
    | 'error'
    | 'metric';

export interface PluginActivityEvent {
    readonly id: string;
    readonly runId: string;
    readonly type: PluginActivityEventType;
    readonly occurredAt: string;
    readonly sequence?: number;
    readonly coalesceKey?: string;
    readonly payload: Readonly<Record<string, unknown>>;
}

export interface PluginActivityRun {
    readonly id: string;
    readonly title: string;
    readonly status: PluginActivityStatus;
    readonly kind?: string;
    readonly startedAt?: string;
    readonly updatedAt: string;
    readonly completedAt?: string;
    readonly summary?: string;
    readonly actions?: readonly PluginActivityAction[];
}

export interface PluginActivityArtifact {
    readonly id: string;
    readonly kind: string;
    readonly label: string;
    readonly href?: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface PluginActivityApproval {
    readonly id: string;
    readonly title: string;
    readonly description?: string;
    readonly status: 'pending' | 'approved' | 'denied' | 'cancelled';
    readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface PluginActivityDetail extends PluginActivityRun {
    readonly events: readonly PluginActivityEvent[];
    readonly output?: string;
    readonly artifacts?: readonly PluginActivityArtifact[];
    readonly approvals?: readonly PluginActivityApproval[];
    readonly error?: string;
}

export interface PluginActivityListInput {
    readonly statuses?: readonly PluginActivityStatus[];
    readonly limit?: number;
}

export interface PluginActivityActionInput {
    readonly runId: string;
    readonly action: PluginActivityAction;
    readonly payload?: Readonly<Record<string, unknown>>;
}

export interface PluginActivitySubscriptionInput {
    readonly runId?: string;
    readonly signal?: AbortSignal;
    readonly onEvent: (event: PluginActivityEvent) => void;
    readonly onError?: (error: { readonly message: string; readonly code?: string }) => void;
}

export interface PluginActivitySource {
    readonly id: string;
    readonly label: string;
    readonly actions?: readonly PluginActivityAction[];
    readonly list: (
        input?: PluginActivityListInput
    ) => Promise<PluginResult<readonly PluginActivityRun[]>>;
    readonly get?: (
        runId: string
    ) => Promise<PluginResult<PluginActivityDetail>>;
    readonly subscribe?: (
        input: PluginActivitySubscriptionInput
    ) => void | (() => void);
    readonly executeAction?: (
        input: PluginActivityActionInput
    ) => Promise<PluginResult<void>>;
}

export interface PluginActivityClient {
    registerSource(input: PluginActivitySource): PluginRegistrationHandle;
}

export interface PluginPost { readonly id: string; readonly postType: string; readonly title: string; readonly content: string; readonly meta?: unknown; readonly created_at: number; readonly updated_at: number }
export interface PluginPostsClient {
    get(id: string): Promise<PluginResult<PluginPost | null>>;
    list(input: { postType: string; limit?: number }): Promise<PluginResult<readonly PluginPost[]>>;
    create(input: { postType: string; title: string; content?: string; meta?: unknown }): Promise<PluginResult<{ id: string }>>;
    update(id: string, patch: { title?: string; content?: string; meta?: unknown }): Promise<PluginResult<void>>;
    delete(id: string): Promise<PluginResult<void>>;
    onChange(listener: () => void): PluginRegistrationHandle;
}
export interface PluginStoredMessage { readonly id: string; readonly threadId: string; readonly streamId: string; readonly role: string; readonly content: string; readonly data: unknown; readonly createdAt: number; readonly updatedAt: number; readonly clock: number; readonly fileIds: readonly string[] }
export interface PluginMessagesClient {
    get(id: string): Promise<PluginResult<PluginStoredMessage | null>>;
    list(input: { type: string }): Promise<PluginResult<readonly PluginStoredMessage[]>>;
    listByThread(threadId: string, input?: { type?: string }): Promise<PluginResult<readonly PluginStoredMessage[]>>;
    upsert(input: { id: string; threadId: string; streamId: string; data: unknown; pending: boolean }): Promise<PluginResult<void>>;
    updateData(updates: readonly { id: string; ifClock: number; ifData: unknown; data: unknown; pending: boolean }[]): Promise<PluginResult<void>>;
    attachFile(id: string, file: PluginFileRef): Promise<PluginResult<void>>;
}
export interface PluginToolsClient {
    list(): Promise<PluginResult<readonly { definition: unknown; enabled: boolean; workflowPolicy?: unknown }[]>>;
    execute(name: string, args: unknown, options?: { signal?: AbortSignal }): Promise<PluginResult<string>>;
}
export interface PluginJobsClient {
    available(): Promise<PluginResult<boolean>>;
    track(input: { jobId: string; threadId: string; messageId: string }): Promise<PluginResult<void>>;
    abort(jobId: string): Promise<PluginResult<void>>;
    status(jobId: string): Promise<PluginResult<string>>;
}
export interface PluginHostClients {
    readonly posts: PluginPostsClient;
    readonly tools: PluginToolsClient;
    readonly jobs: PluginJobsClient;
    readonly ai: PluginAiClient;
    readonly ui: PluginUiClient;
    readonly panes: PluginPanesClient;
    readonly commands: PluginCommandsClient;
    readonly chat: PluginChatClient;
    readonly workspace: PluginWorkspaceClient;
    readonly events: PluginEventsClient;
    readonly secrets: PluginSecretsClient;
    readonly files: PluginFilesClient;
    readonly http: PluginHttpClient;
    readonly network: PluginNetworkClient;
    readonly activity: PluginActivityClient;
}

export type PluginClientFactory<T> = (scope: {
    readonly pluginId: string;
    readonly workspaceId: string;
    readonly generation: number;
    readonly signal: AbortSignal;
}) => T;

export interface PluginHostClientFactories {
    readonly createSettingsClient: PluginClientFactory<PluginSettingsClient>;
    readonly createStorageClient: PluginClientFactory<PluginStorageClient>;
    readonly createClients?: PluginClientFactory<PluginHostClients>;
}

export type PluginServiceError = PluginError;

function unsupported<T>(capability: string): PluginResult<T> {
    return pluginError('unsupported', `${capability} is not available in this host`);
}

function unsupportedHandle(capability: string): PluginRegistrationHandle {
    throw Object.assign(new Error(`${capability} is not available in this host`), {
        code: 'unsupported' as const,
        retryable: false,
    });
}

/**
 * Safe defaults for hosts that have not opted into a capability yet. Keeping
 * these clients present makes the context shape stable while preserving the
 * host's authority boundary.
 */
export function createUnsupportedPluginClients(input: {
    readonly workspaceId: string;
}): PluginHostClients {
    const events: PluginEventsClient = {
        on: () => unsupportedHandle('events'),
    };
    const workspace: PluginWorkspaceClient = {
        id: input.workspaceId,
        onChange: () => unsupportedHandle('workspace.onChange'),
        switch: async () => unsupported('workspace.switch'),
        connections: {
            status: async () => unsupported('workspace.connections.status'), remove: async () => unsupported('workspace.connections.remove'),
            list: async () => unsupported('workspace.connections.list'),
            manage: async () => unsupported('workspace.connections.manage'),
        },
    };
    return {
        posts: { get: async () => unsupported('posts.get'), list: async () => unsupported('posts.list'), create: async () => unsupported('posts.create'), update: async () => unsupported('posts.update'), delete: async () => unsupported('posts.delete'), onChange: () => unsupportedHandle('posts.onChange') },
        tools: { list: async () => unsupported('tools.list'), execute: async () => unsupported('tools.execute') },
        jobs: { available: async () => unsupported('jobs.available'), track: async () => unsupported('jobs.track'), abort: async () => unsupported('jobs.abort'), status: async () => unsupported('jobs.status') },
        ai: {
            provider: async () => unsupported('ai.provider'), requestSignIn: () => unsupported('ai.requestSignIn'), onModelsChange: () => unsupportedHandle('ai.onModelsChange'),
            models: async () => unsupported('ai.models'),
            complete: async () => unsupported('ai.complete'),
        },
        ui: {
            sidebar: { show: async () => unsupported('ui.sidebar.show'), closeIfMobile: () => unsupported('ui.sidebar.closeIfMobile') },
            registerWorkspaceProfile: () => unsupportedHandle('ui.registerWorkspaceProfile'),
            registerSidebar: () => unsupportedHandle('ui.registerSidebar'),
            registerPane: () => unsupportedHandle('ui.registerPane'),
            registerCard: () => unsupportedHandle('ui.registerCard'),
            registerAction: () => unsupportedHandle('ui.registerAction'),
            toast: () => unsupported('ui.toast'),
            confirm: async () => unsupported('ui.confirm'),
            progress: () => unsupported('ui.progress'),
        },
        panes: {
            list: async () => unsupported('panes.list'), onChange: () => unsupportedHandle('panes.onChange'),
            open: async () => unsupported('panes.open'),
            focus: async () => unsupported('panes.focus'),
            close: async () => unsupported('panes.close'),
        },
        commands: {
            register: () => unsupportedHandle('commands.register'),
            run: async () => unsupported('commands.run'),
        },
        chat: {
            registerToolCard: () =>
                unsupportedHandle(
                    'Declare portable tool cards in or3.manifest.json toolCards.'
                ),
            messages: { get: async () => unsupported('chat.messages.get'), list: async () => unsupported('chat.messages.list'), listByThread: async () => unsupported('chat.messages.listByThread'), upsert: async () => unsupported('chat.messages.upsert'), updateData: async () => unsupported('chat.messages.updateData'), attachFile: async () => unsupported('chat.messages.attachFile') },
            composer: {
                prefill: async () => unsupported('chat.composer.prefill'),
            },
            send: { markHandled: () => unsupported('chat.send.markHandled') },
            create: async () => unsupported('chat.create'),
            open: async () => unsupported('chat.open'),
            appendMessage: async () => unsupported('chat.appendMessage'),
        },
        workspace,
        events,
        secrets: {
            get: async () => unsupported('secrets.get'),
            set: async () => unsupported('secrets.set'),
            delete: async () => unsupported('secrets.delete'),
            ref: async () => unsupported('secrets.ref'),
            status: async () => unsupported('secrets.status'),
            unlock: async () => unsupported('secrets.unlock'),
        },
        files: {
            catalog: {
                list: async () => unsupported('files.catalog.list'),
                get: async () => unsupported('files.catalog.get'),
                save: async () => unsupported('files.catalog.save'),
                update: async () => unsupported('files.catalog.update'),
                enableText: async () => unsupported('files.catalog.enableText'),
                remove: async () => unsupported('files.catalog.remove'),
            },
            registerAction: () => unsupportedHandle('files.registerAction'),
            limits: async () => unsupported('files.limits'),
            pick: async () => unsupported('files.pick'),
            read: async () => unsupported('files.read'),
            write: async () => unsupported('files.write'),
        },
        http: {
            fetch: async () => unsupported('http.fetch'),
            request: async () => unsupported('http.request'),
        },
        network: {
            requestAccess: async () => unsupported('network.requestAccess'), revokeAccess: async () => unsupported('network.revokeAccess'),
            stream: async () => unsupported('network.stream'),
        },
        activity: {
            registerSource: () => unsupportedHandle('activity.registerSource'),
        },
    };
}
