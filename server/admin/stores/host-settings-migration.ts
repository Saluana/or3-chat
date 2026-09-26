/**
 * @module server/admin/stores/host-settings-migration
 *
 * Purpose:
 * Applies the host's migration policy when a provider exposes legacy values
 * from a client-writable settings namespace.
 *
 * Behavior:
 * - The private store is always read first; migration only fills an absent
 *   value.
 * - `authority` and `unknown` keys are never read from legacy storage.
 * - `spend-ledger` and `user-data` keys are copied once, byte-for-byte, using
 *   the provider CAS when available so concurrent hosts converge on one
 *   winner. A losing CAS re-reads the private store instead of overwriting.
 * - Providers without `getLegacy` (all private settings already) are returned
 *   unchanged.
 *
 * Constraints:
 * - Legacy values are copied, never merged. Authority must be re-established
 *   through a trusted host path.
 */
import type { WorkspaceSettingsStore } from './types';
import { mayMigrateLegacyHostSetting } from './host-settings-policy';

type LegacyReader = (workspaceId: string, key: string) => Promise<string | null>;

async function takeOverLegacyValue(
    store: WorkspaceSettingsStore,
    getLegacy: LegacyReader,
    workspaceId: string,
    key: string
): Promise<string | null> {
    const legacy = await getLegacy(workspaceId, key);
    if (legacy === null) return null;

    if (store.compareAndSet) {
        const copied = await store.compareAndSet(workspaceId, key, null, legacy);
        // A failed copy means another writer reached the private store first;
        // trust the private value, never re-apply the legacy copy.
        return copied ? legacy : await store.get(workspaceId, key);
    }

    // Providers without CAS are serialized within one host process by
    // contract. A leftover legacy record cannot win over a private value.
    const existing = await store.get(workspaceId, key);
    if (existing !== null) return existing;
    await store.set(workspaceId, key, legacy);
    return await store.get(workspaceId, key);
}

/**
 * Wraps a provider settings store with the host migration policy.
 *
 * @returns The same store when the provider has no legacy namespace.
 */
export function withTrustedHostSettingsMigration(
    store: WorkspaceSettingsStore
): WorkspaceSettingsStore {
    const getLegacy = store.getLegacy?.bind(store);
    if (!getLegacy) return store;

    const wrapped: WorkspaceSettingsStore = {
        async get(workspaceId, key) {
            const current = await store.get(workspaceId, key);
            if (current !== null) return current;
            if (!mayMigrateLegacyHostSetting(key)) return null;
            return await takeOverLegacyValue(store, getLegacy, workspaceId, key);
        },
        set(workspaceId, key, value) {
            return store.set(workspaceId, key, value);
        },
    };
    if (store.compareAndSet) {
        const compareAndSet = store.compareAndSet.bind(store);
        wrapped.compareAndSet = (workspaceId, key, expectedValue, nextValue) =>
            compareAndSet(workspaceId, key, expectedValue, nextValue);
    }
    return wrapped;
}
