import type { SyncScope } from '~~/shared/sync/types';
import type { SubscriptionManager } from './subscription-manager';

// Keep scope ownership and synchronous cleanup available without loading sync transports.
// Singleton instances per scope
export const subscriptionManagerInstances = new Map<string, SubscriptionManager>();

/**
 * Get scope key for instance lookup
 */
export function getScopeKey(scope: SyncScope): string {
    const principal = scope.principalId ? `:principal:${encodeURIComponent(scope.principalId)}` : '';
    return `${scope.workspaceId}:${scope.projectId ?? 'default'}${principal}`;
}

/** Return the manager currently owned by a sync scope. */
export function getSubscriptionManager(scope: SyncScope): SubscriptionManager | null {
    return subscriptionManagerInstances.get(getScopeKey(scope)) ?? null;
}

/** Stop and clear all managers. Test-only lifecycle support. */
export async function _resetSubscriptionManagers(): Promise<void> {
    for (const manager of subscriptionManagerInstances.values()) {
        await manager.stop();
    }
    subscriptionManagerInstances.clear();
}

/**
 * Purpose:
 * Stop and remove a SubscriptionManager instance by scope key.
 */
export function cleanupSubscriptionManager(scopeKey: string): void {
    const manager = subscriptionManagerInstances.get(scopeKey);
    if (manager) {
        manager.stop().catch((error) => {
            console.error('[SubscriptionManager] Failed to stop instance:', error);
        });
    }
    subscriptionManagerInstances.delete(scopeKey);
}

/**
 * Purpose:
 * Stop and remove all SubscriptionManager instances for a workspace.
 */
export function cleanupSubscriptionManagersByWorkspace(
    workspaceId: string
): void {
    const prefix = `${workspaceId}:`;
    for (const [scopeKey, manager] of subscriptionManagerInstances.entries()) {
        if (!scopeKey.startsWith(prefix)) continue;
        manager.stop().catch((error) => {
            console.error('[SubscriptionManager] Failed to stop instance:', error);
        });
        subscriptionManagerInstances.delete(scopeKey);
    }
}
