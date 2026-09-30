/**
 * Plugin connection store contract and registry.
 *
 * Providers register a store so connection state persists with the active sync
 * provider (SQLite in a Cloud deployment). A memory store is always available
 * for tests and for providers without durable storage; it is never used
 * silently in place of a configured durable store.
 */

import type {
    ConnectionTestEvidence,
    PluginConnectionUpdate,
    StoredPluginConnection,
} from '~~/shared/plugins/connections/contracts';

export interface PluginConnectionStore {
    list(input: {
        readonly ownerUserId: string;
        readonly workspaceId: string;
        readonly pluginId?: string;
    }): Promise<readonly StoredPluginConnection[]>;
    get(id: string): Promise<StoredPluginConnection | null>;
    /**
     * Insert-only creation. `false` means the id already exists: the caller must
     * retry with a fresh id (or fail), never write over the existing record.
     */
    insert(connection: StoredPluginConnection): Promise<boolean>;
    /**
     * Compare-and-swap update keyed on the revision the caller read. `false`
     * means the record is gone or the revision moved, so a concurrent rotation
     * cannot be silently overwritten.
     */
    update(update: PluginConnectionUpdate): Promise<boolean>;
    delete(id: string): Promise<void>;
    getTestEvidence(connectionId: string): Promise<ConnectionTestEvidence | null>;
    /**
     * Records evidence only when it belongs to the connection's current revision
     * and is not older than the stored record. `false` means the write was
     * rejected as stale (a rotation or a newer test won).
     */
    setTestEvidence(evidence: ConnectionTestEvidence): Promise<boolean>;
}

export interface PluginConnectionStoreRegistryItem {
    readonly id: string;
    readonly order?: number;
    readonly create: () => PluginConnectionStore;
}

const stores = new Map<string, PluginConnectionStoreRegistryItem>();
/** One instance per provider: the SQLite store opens tables on construction. */
const instances = new Map<string, PluginConnectionStore>();

export function registerPluginConnectionStore(
    item: PluginConnectionStoreRegistryItem
): void {
    stores.set(item.id, item);
    instances.delete(item.id);
}

export function getPluginConnectionStore(id: string): PluginConnectionStore | null {
    const item = stores.get(id);
    if (!item) return null;
    const existing = instances.get(id);
    if (existing) return existing;
    const created = item.create();
    instances.set(id, created);
    return created;
}

export function listPluginConnectionStoreIds(): string[] {
    return [...stores.keys()].sort();
}
