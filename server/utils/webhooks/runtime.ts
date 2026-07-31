import type { NitroApp } from 'nitropack';
import type { WebhookDispatcher } from './dispatcher';
import type { WebhookEventBridge } from './event-bridge';
import type { WebhookStore } from './store/types';

export interface ActiveWebhookRuntime {
    nitroApp: Pick<NitroApp, 'hooks'>;
    store: WebhookStore;
    dispatcher: WebhookDispatcher;
    bridge: WebhookEventBridge;
    workerId: string;
    stop(): void;
}

let activeRuntime: ActiveWebhookRuntime | null = null;

type NitroHooksLike = {
    callHook?: (name: string, ...args: unknown[]) => Promise<unknown> | unknown;
};

export function setActiveWebhookRuntime(
    runtime: ActiveWebhookRuntime | null
): void {
    activeRuntime = runtime;
}

export function getActiveWebhookRuntime(): ActiveWebhookRuntime | null {
    return activeRuntime;
}

export function stopActiveWebhookRuntime(): void {
    activeRuntime?.stop();
    activeRuntime = null;
}

export async function emitWebhookSystemHook(
    hookName: string,
    ...args: unknown[]
): Promise<void> {
    const hooks = activeRuntime?.nitroApp.hooks as NitroHooksLike | undefined;
    const callHook = hooks?.callHook;
    if (typeof callHook !== 'function') {
        return;
    }

    try {
        await callHook(hookName, ...args);
    } catch (error) {
        console.warn('[webhooks] Failed to emit runtime hook', {
            hookName,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

export async function refreshActiveWebhookCustomHookListeners(): Promise<void> {
    if (!activeRuntime) {
        return;
    }

    await activeRuntime.bridge.refreshCustomHookListeners();
}
