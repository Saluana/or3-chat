import type { NitroApp } from 'nitropack';
import { buildWebhookPayload } from './payload';
import type { WebhookDispatcher } from './dispatcher';
import type { WebhookStore } from './store/types';

export const USER_HOOK_TO_EVENT_MAP: Record<string, string> = {
    'db.threads.create:action:after': 'thread.created',
    'db.threads.update:action:after': 'thread.updated',
    'db.threads.delete:action:soft:after': 'thread.deleted',
    'db.messages.create:action:after': 'message.created',
    'db.messages.update:action:after': 'message.updated',
    'ai.chat.stream:action:complete': 'message.completed',
    'db.documents.create:action:after': 'document.created',
    'db.documents.update:action:after': 'document.updated',
    'db.documents.delete:action:soft:after': 'document.deleted',
    'notify:action:push': 'notification.created',
};

export const ADMIN_HOOK_TO_EVENT_MAP: Record<string, string> = {
    'auth.user:action:created': 'admin.user.created',
    'admin.workspace:action:created': 'admin.workspace.created',
    'admin.workspace:action:deleted': 'admin.workspace.deleted',
    'admin.user:action:role_changed': 'admin.user.role_changed',
    'admin.plugin:action:installed': 'admin.plugin.installed',
    'admin.plugin:action:enabled': 'admin.plugin.enabled',
    'admin.plugin:action:disabled': 'admin.plugin.disabled',
    'sync:action:error': 'admin.sync.error',
    'storage:action:error': 'admin.storage.error',
    'background.job:completed': 'admin.job.completed',
    'background.job:failed': 'admin.job.failed',
};

export interface WebhookEventBridge {
    start(): void;
    stop(): void;
    refreshCustomHookListeners(): Promise<void>;
}

type HookArgs = unknown[];

function toRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }

    return value as Record<string, unknown>;
}

function getNestedString(
    value: unknown,
    path: string[]
): string | undefined {
    let current: unknown = value;
    for (const segment of path) {
        if (!current || typeof current !== 'object' || Array.isArray(current)) {
            return undefined;
        }
        current = (current as Record<string, unknown>)[segment];
    }

    return typeof current === 'string' ? current : undefined;
}

function extractWorkspaceId(value: unknown): string | undefined {
    const record = toRecord(value);
    return (
        (typeof record.workspace_id === 'string' ? record.workspace_id : undefined) ??
        (typeof record.workspaceId === 'string' ? record.workspaceId : undefined) ??
        getNestedString(value, ['workspace', 'id']) ??
        getNestedString(value, ['scope', 'workspaceId'])
    );
}

function extractWorkspaceIdFromArgs(args: HookArgs): string | undefined {
    for (const value of args) {
        const workspaceId = extractWorkspaceId(value);
        if (workspaceId) {
            return workspaceId;
        }
    }

    return undefined;
}

function extractUserId(value: unknown): string | undefined {
    const record = toRecord(value);
    return (
        (typeof record.user_id === 'string' ? record.user_id : undefined) ??
        (typeof record.userId === 'string' ? record.userId : undefined) ??
        getNestedString(value, ['user', 'id']) ??
        getNestedString(value, ['actor', 'user_id']) ??
        getNestedString(value, ['actor', 'userId'])
    );
}

function extractUserIdFromArgs(args: HookArgs): string | undefined {
    for (const value of args) {
        const userId = extractUserId(value);
        if (userId) {
            return userId;
        }
    }

    return undefined;
}

export function createWebhookEventBridge(
    store: WebhookStore,
    dispatcher: WebhookDispatcher,
    nitroApp: NitroApp
): WebhookEventBridge {
    const hooks = nitroApp.hooks as unknown as {
        hook: (name: string, fn: (...args: HookArgs) => unknown) => () => void;
    };
    const curatedUnhooks: Array<() => void> = [];
    const customUnhooks = new Map<string, () => void>();
    const inactiveEventTypes = new Set<string>();
    let started = false;

    const buildInactiveKey = (
        scope: 'user' | 'admin',
        eventType: string,
        workspaceId?: string
    ): string => `${scope}:${eventType}:${workspaceId ?? '*'}`;

    const maybeSkipInactive = (
        scope: 'user' | 'admin',
        eventType: string,
        workspaceId?: string
    ): boolean => inactiveEventTypes.has(buildInactiveKey(scope, eventType, workspaceId));

    const markInactive = (
        scope: 'user' | 'admin',
        eventType: string,
        workspaceId?: string
    ): void => {
        inactiveEventTypes.add(buildInactiveKey(scope, eventType, workspaceId));
    };

    const markActive = (
        scope: 'user' | 'admin',
        eventType: string,
        workspaceId?: string
    ): void => {
        inactiveEventTypes.delete(buildInactiveKey(scope, eventType, workspaceId));
    };

    async function handleCuratedEvent(
        scope: 'user' | 'admin',
        eventType: string,
        args: HookArgs
    ): Promise<void> {
        const primaryPayload = args.length <= 1 ? args[0] : args;
        const workspaceId =
            extractWorkspaceId(primaryPayload) ?? extractWorkspaceIdFromArgs(args);
        if (maybeSkipInactive(scope, eventType, workspaceId)) {
            return;
        }
        const webhooks = await store.listWebhooksByEvent(
            eventType,
            scope,
            workspaceId
        );

        if (webhooks.length === 0) {
            markInactive(scope, eventType, workspaceId);
            return;
        }

        markActive(scope, eventType, workspaceId);

        for (const webhook of webhooks) {
            if (!webhook.enabled) {
                continue;
            }

            const payload = buildWebhookPayload({
                event: eventType,
                data: primaryPayload,
                workspaceId: workspaceId ?? webhook.workspace_id,
                userId:
                    scope === 'user'
                        ? webhook.user_id ??
                          extractUserId(primaryPayload) ??
                          extractUserIdFromArgs(args)
                        : undefined,
                scope,
            });

            await dispatcher.enqueue({
                webhookId: webhook.id,
                eventType,
                eventId: payload.event_id,
                payload,
            });
        }
    }

    async function handleCustomHook(
        hookName: string,
        args: HookArgs
    ): Promise<void> {
        const primaryPayload = args.length === 1 ? args[0] : args;
        const workspaceId =
            extractWorkspaceId(primaryPayload) ?? extractWorkspaceIdFromArgs(args);
        const webhooks = await store.listWebhooksByCustomHook(hookName);

        for (const webhook of webhooks) {
            if (!webhook.enabled) {
                continue;
            }
            if (webhook.workspace_id && webhook.workspace_id !== workspaceId) {
                continue;
            }

            const payload = buildWebhookPayload({
                event: hookName,
                data: args,
                workspaceId: workspaceId ?? webhook.workspace_id,
                scope: 'admin',
            });

            await dispatcher.enqueue({
                webhookId: webhook.id,
                eventType: hookName,
                eventId: payload.event_id,
                payload,
            });
        }
    }

    function registerMappedHooks(map: Record<string, string>, scope: 'user' | 'admin'): void {
        for (const [hookName, eventType] of Object.entries(map)) {
            const unhook = hooks.hook(hookName, (...args: HookArgs) => {
                return handleCuratedEvent(scope, eventType, args);
            });
            curatedUnhooks.push(unhook);
        }
    }

    return {
        start() {
            if (started) {
                return;
            }

            started = true;
            inactiveEventTypes.clear();
            registerMappedHooks(USER_HOOK_TO_EVENT_MAP, 'user');
            registerMappedHooks(ADMIN_HOOK_TO_EVENT_MAP, 'admin');
            void this.refreshCustomHookListeners();
        },

        stop() {
            started = false;
            while (curatedUnhooks.length > 0) {
                curatedUnhooks.pop()?.();
            }
            for (const unhook of customUnhooks.values()) {
                unhook();
            }
            customUnhooks.clear();
            inactiveEventTypes.clear();
        },

        async refreshCustomHookListeners() {
            inactiveEventTypes.clear();

            const nextHooks = new Set(await store.listActiveCustomHookNames());
            for (const [hookName, unhook] of customUnhooks.entries()) {
                if (!nextHooks.has(hookName)) {
                    unhook();
                    customUnhooks.delete(hookName);
                }
            }

            for (const hookName of nextHooks) {
                if (customUnhooks.has(hookName)) {
                    continue;
                }

                const unhook = hooks.hook(
                    hookName,
                    (...args: HookArgs) => {
                        return handleCustomHook(hookName, args);
                    }
                );
                customUnhooks.set(hookName, unhook);
            }
        },
    };
}
