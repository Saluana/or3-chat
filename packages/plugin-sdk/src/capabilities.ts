import type {
    PluginJsonValue,
    PluginSettingsClient,
    PluginStorageClient,
} from './clients';
import type { PluginRegistrationHandle } from './contracts';
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
}

export interface PluginPaneDefinition {
    readonly id: string;
    readonly label: string;
    readonly icon?: string;
    readonly order?: number;
    readonly dataVersion?: number;
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

export interface PluginUiClient {
    registerSidebar(definition: PluginSidebarDefinition): PluginRegistrationHandle;
    registerPane(definition: PluginPaneDefinition): PluginRegistrationHandle;
    registerCard(definition: PluginCardDefinition): PluginRegistrationHandle;
    registerAction(definition: PluginActionDefinition): PluginRegistrationHandle;
    toast(input: PluginToastInput): PluginResult<void>;
    confirm(input: PluginConfirmInput): Promise<PluginResult<boolean>>;
    progress(input: { readonly label: string; readonly max?: number }): PluginResult<PluginProgressHandle>;
}

export type PluginPaneTarget = 'focus-or-new' | 'new' | 'replace-active';

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

export interface PluginPanesClient {
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
    | { readonly kind: 'multipart'; readonly fields: Readonly<Record<string, string>>; readonly files: readonly PluginFileRef[] };

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

export interface PluginHostClients {
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
    throw new Error(`${capability} is not available in this host`);
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
            list: async () => unsupported('workspace.connections.list'),
            manage: async () => unsupported('workspace.connections.manage'),
        },
    };
    return {
        ai: {
            models: async () => unsupported('ai.models'),
            complete: async () => unsupported('ai.complete'),
        },
        ui: {
            registerSidebar: () => unsupportedHandle('ui.registerSidebar'),
            registerPane: () => unsupportedHandle('ui.registerPane'),
            registerCard: () => unsupportedHandle('ui.registerCard'),
            registerAction: () => unsupportedHandle('ui.registerAction'),
            toast: () => unsupported('ui.toast'),
            confirm: async () => unsupported('ui.confirm'),
            progress: () => unsupported('ui.progress'),
        },
        panes: {
            open: async () => unsupported('panes.open'),
            focus: async () => unsupported('panes.focus'),
            close: async () => unsupported('panes.close'),
        },
        commands: {
            register: () => unsupportedHandle('commands.register'),
            run: async () => unsupported('commands.run'),
        },
        chat: {
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
            pick: async () => unsupported('files.pick'),
            read: async () => unsupported('files.read'),
            write: async () => unsupported('files.write'),
        },
        http: {
            fetch: async () => unsupported('http.fetch'),
            request: async () => unsupported('http.request'),
        },
        network: {
            stream: async () => unsupported('network.stream'),
        },
        activity: {
            registerSource: () => unsupportedHandle('activity.registerSource'),
        },
    };
}
