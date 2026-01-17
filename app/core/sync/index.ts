/**
 * Sync Module Barrel Export
 *
 * Re-exports all sync components for convenient importing.
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

// Convex provider
export { createConvexSyncProvider } from './providers/convex-sync-provider';
export { createGatewaySyncProvider } from './providers/gateway-sync-provider';

