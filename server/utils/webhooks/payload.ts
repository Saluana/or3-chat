import { randomUUID } from 'node:crypto';
import type {
    AdminErrorEventData,
    AdminJobEventData,
    AdminPluginEventData,
    AdminUserEventData,
    AdminWorkspaceEventData,
    DocumentEventData,
    MessageCompletedEventData,
    MessageEventData,
    NotificationEventData,
    ThreadEventData,
} from '../../../shared/webhooks/event-schemas';
import type { WebhookPayload } from '../../../shared/webhooks/payload';
import type { WebhookScope } from '../../../shared/webhooks/event-types';

const MAX_MESSAGE_CONTENT_CHARS = 4 * 1024;
const SENSITIVE_KEYS = new Set([
    'api_key',
    'apikey',
    'password',
    'token',
    'secret',
    'signing_secret',
    'authorization',
]);

type PayloadRecord = Record<string, unknown>;

export interface BuildWebhookPayloadInput {
    event: string;
    data: unknown;
    workspaceId?: string | null;
    userId?: string | null;
    scope?: WebhookScope;
}

function toRecord(value: unknown): PayloadRecord {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }

    return value as PayloadRecord;
}

function getValue(record: PayloadRecord, ...keys: string[]): unknown {
    for (const key of keys) {
        if (key in record) {
            return record[key];
        }
    }

    return undefined;
}

function getString(record: PayloadRecord, ...keys: string[]): string | undefined {
    const value = getValue(record, ...keys);
    return typeof value === 'string' ? value : undefined;
}

function getNullableString(
    record: PayloadRecord,
    ...keys: string[]
): string | null | undefined {
    const value = getValue(record, ...keys);
    if (typeof value === 'string') return value;
    if (value === null) return null;
    return undefined;
}

function getNumber(record: PayloadRecord, ...keys: string[]): number | undefined {
    const value = getValue(record, ...keys);
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getBoolean(record: PayloadRecord, ...keys: string[]): boolean | undefined {
    const value = getValue(record, ...keys);
    return typeof value === 'boolean' ? value : undefined;
}

function truncate(value: string | null | undefined, max: number): string | null | undefined {
    if (typeof value !== 'string') return value;
    if (value.length <= max) return value;
    return value.slice(0, max);
}

function sanitizeSensitiveFields(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map((item) => sanitizeSensitiveFields(item));
    }

    if (!value || typeof value !== 'object') {
        return value;
    }

    const result: PayloadRecord = {};
    for (const [key, nestedValue] of Object.entries(value as PayloadRecord)) {
        const normalized = key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
        if (SENSITIVE_KEYS.has(normalized)) {
            continue;
        }

        result[key] = sanitizeSensitiveFields(nestedValue);
    }

    return result;
}

export function extractThreadData(input: unknown): ThreadEventData {
    const record = toRecord(sanitizeSensitiveFields(input));
    return {
        id: getString(record, 'id') ?? '',
        title: getNullableString(record, 'title'),
        status: getNullableString(record, 'status'),
        deleted: getBoolean(record, 'deleted'),
        pinned: getBoolean(record, 'pinned'),
        created_at: getNumber(record, 'created_at', 'createdAt'),
        updated_at: getNumber(record, 'updated_at', 'updatedAt'),
    };
}

export function extractMessageData(input: unknown): MessageEventData {
    const record = toRecord(sanitizeSensitiveFields(input));
    return {
        id: getString(record, 'id') ?? '',
        thread_id: getString(record, 'thread_id', 'threadId') ?? '',
        role: getNullableString(record, 'role'),
        content: truncate(
            getNullableString(record, 'content'),
            MAX_MESSAGE_CONTENT_CHARS
        ),
        deleted: getBoolean(record, 'deleted'),
        index: getNumber(record, 'index'),
        order_key: getNullableString(record, 'order_key', 'orderKey'),
        created_at: getNumber(record, 'created_at', 'createdAt'),
        updated_at: getNumber(record, 'updated_at', 'updatedAt'),
    };
}

export function extractDocumentData(input: unknown): DocumentEventData {
    const record = toRecord(sanitizeSensitiveFields(input));
    const content = getNullableString(record, 'content');
    return {
        id: getString(record, 'id') ?? '',
        title: getNullableString(record, 'title', 'name'),
        content_length:
            typeof content === 'string'
                ? content.length
                : getNumber(record, 'content_length', 'contentLength') ?? null,
        deleted: getBoolean(record, 'deleted'),
        created_at: getNumber(record, 'created_at', 'createdAt'),
        updated_at: getNumber(record, 'updated_at', 'updatedAt'),
    };
}

export function extractNotificationData(input: unknown): NotificationEventData {
    const record = toRecord(sanitizeSensitiveFields(input));
    return {
        id: getString(record, 'id') ?? '',
        user_id: getString(record, 'user_id', 'userId') ?? '',
        thread_id: getNullableString(record, 'thread_id', 'threadId'),
        document_id: getNullableString(record, 'document_id', 'documentId'),
        type: getNullableString(record, 'type'),
        title: getNullableString(record, 'title'),
        body: getNullableString(record, 'body'),
        read_at: getNumber(record, 'read_at', 'readAt') ?? null,
        created_at: getNumber(record, 'created_at', 'createdAt'),
        updated_at: getNumber(record, 'updated_at', 'updatedAt'),
    };
}

export function extractMessageCompletedData(
    input: unknown
): MessageCompletedEventData {
    const record = toRecord(sanitizeSensitiveFields(input));
    return {
        thread_id: getString(record, 'thread_id', 'threadId') ?? '',
        message_id: getString(record, 'message_id', 'messageId') ?? '',
        model_id: getNullableString(record, 'model_id', 'modelId'),
        job_id: getNullableString(record, 'job_id', 'jobId'),
        completed_at:
            getNullableString(record, 'completed_at', 'completedAt') ??
            new Date().toISOString(),
    };
}

export function extractAdminUserData(input: unknown): AdminUserEventData {
    const record = toRecord(sanitizeSensitiveFields(input));
    return {
        user_id:
            getString(record, 'user_id', 'userId', 'id') ?? '',
        email: getNullableString(record, 'email'),
        role: getNullableString(record, 'role'),
        workspace_id: getNullableString(record, 'workspace_id', 'workspaceId'),
    };
}

export function extractAdminWorkspaceData(
    input: unknown
): AdminWorkspaceEventData {
    const record = toRecord(sanitizeSensitiveFields(input));
    return {
        workspace_id:
            getString(record, 'workspace_id', 'workspaceId', 'id') ?? '',
        name: getNullableString(record, 'name', 'title'),
        slug: getNullableString(record, 'slug'),
        deleted_at: getNumber(record, 'deleted_at', 'deletedAt') ?? null,
    };
}

export function extractAdminPluginData(input: unknown): AdminPluginEventData {
    const record = toRecord(sanitizeSensitiveFields(input));
    return {
        plugin_id:
            getString(record, 'plugin_id', 'pluginId', 'id') ?? '',
        plugin_type: getNullableString(record, 'plugin_type', 'pluginType', 'type'),
        version: getNullableString(record, 'version'),
        workspace_id: getNullableString(record, 'workspace_id', 'workspaceId'),
    };
}

export function extractAdminErrorData(input: unknown): AdminErrorEventData {
    const record = toRecord(sanitizeSensitiveFields(input));
    const source = getString(record, 'source') ?? 'unknown';
    return {
        source,
        message:
            getString(record, 'message', 'error') ??
            `Unhandled ${source} error`,
        code: getNullableString(record, 'code'),
        workspace_id: getNullableString(record, 'workspace_id', 'workspaceId'),
        details: toRecord(getValue(record, 'details')),
    };
}

export function extractAdminJobData(input: unknown): AdminJobEventData {
    const record = toRecord(sanitizeSensitiveFields(input));
    return {
        job_id: getString(record, 'job_id', 'jobId', 'id') ?? '',
        status:
            getString(record, 'status') === 'failed'
                ? 'failed'
                : 'completed',
        workspace_id: getNullableString(record, 'workspace_id', 'workspaceId'),
        user_id: getNullableString(record, 'user_id', 'userId'),
        thread_id: getNullableString(record, 'thread_id', 'threadId'),
        message_id: getNullableString(record, 'message_id', 'messageId'),
        error: getNullableString(record, 'error', 'message'),
    };
}

export function serializeHookArgs(args: unknown[]): Record<string, unknown> {
    try {
        return JSON.parse(JSON.stringify({ args })) as Record<string, unknown>;
    } catch {
        return {
            args: [],
            _serialization_error: true,
        };
    }
}

function extractData(event: string, input: unknown, scope?: WebhookScope): unknown {
    if (event.startsWith('thread.')) return extractThreadData(input);
    if (event === 'message.completed') return extractMessageCompletedData(input);
    if (event.startsWith('message.')) return extractMessageData(input);
    if (event.startsWith('document.')) return extractDocumentData(input);
    if (event === 'notification.created') return extractNotificationData(input);
    if (event.startsWith('admin.user.')) return extractAdminUserData(input);
    if (event.startsWith('admin.workspace.')) return extractAdminWorkspaceData(input);
    if (event.startsWith('admin.plugin.')) return extractAdminPluginData(input);
    if (event === 'admin.sync.error' || event === 'admin.storage.error') {
        return extractAdminErrorData(input);
    }
    if (event.startsWith('admin.job.')) return extractAdminJobData(input);
    if (scope === 'admin') {
        return serializeHookArgs(Array.isArray(input) ? input : [input]);
    }

    return sanitizeSensitiveFields(input);
}

export function buildWebhookPayload(
    input: BuildWebhookPayloadInput
): WebhookPayload<unknown> {
    return {
        event: input.event,
        event_id: randomUUID(),
        timestamp: new Date().toISOString(),
        workspace_id: input.workspaceId ?? null,
        user_id: input.scope === 'admin' ? undefined : input.userId ?? null,
        scope: input.scope,
        data: extractData(input.event, input.data, input.scope),
    };
}
