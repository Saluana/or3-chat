/**
 * @module app/core/sync
 *
 * Purpose:
 * Barrel export for the sync subsystem. Re-exports all managers,
 * utilities, and provider factories needed to set up workspace sync.
 *
 * @see planning/db-sync-layer for architecture documentation
 */

// Core utilities
export * from './hlc';
export { normalizeSyncPayload } from './sync-payload-normalizer';

// Bridge and managers
export { HookBridge, getHookBridge, _resetHookBridge } from './hook-bridge';
export { OutboxManager, type OutboxManagerConfig } from './outbox-manager';
export { ConflictResolver, type ApplyResult, type ChangeResult } from './conflict-resolver';
export { GcManager, type GcManagerConfig } from './gc-manager';
export { CursorManager, getCursorManager, _resetCursorManagers } from './cursor-manager';
export {
    SubscriptionManager,
    createSubscriptionManager,
    getSubscriptionManager,
    _resetSubscriptionManagers,
    type SubscriptionManagerConfig,
    type SubscriptionStatus,
} from './subscription-manager';

// Provider registry
export {
    registerSyncProvider,
    unregisterSyncProvider,
    setActiveSyncProvider,
    getActiveSyncProvider,
    getSyncProvider,
    getAllSyncProviders,
} from './sync-provider-registry';

export { createGatewaySyncProvider } from './providers/gateway-sync-provider';
