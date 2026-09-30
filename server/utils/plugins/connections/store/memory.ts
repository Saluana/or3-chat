/**
 * In-memory plugin connection store.
 *
 * Used by tests and by providers without durable storage. Because it does not
 * survive a restart, the service reports the active store id so callers can
 * surface "connections will not persist on this provider" accurately instead of
 * implying durability.
 */

import type {
    ConnectionTestEvidence,
    StoredPluginConnection,
} from '~~/shared/plugins/connections/contracts';
import type { PluginConnectionStore } from './registry';

export function createMemoryPluginConnectionStore(): PluginConnectionStore {
    const connections = new Map<string, StoredPluginConnection>();
    const evidence = new Map<string, ConnectionTestEvidence>();

    return {
        async list({ ownerUserId, workspaceId, pluginId }) {
            return [...connections.values()]
                .filter(
                    (connection) =>
                        connection.ownerUserId === ownerUserId &&
                        connection.workspaceId === workspaceId &&
                        (pluginId === undefined || connection.pluginId === pluginId)
                )
                .map((connection) => ({ ...connection }));
        },
        async get(id) {
            const connection = connections.get(id);
            return connection ? { ...connection } : null;
        },
        async insert(connection) {
            if (connections.has(connection.id)) return false;
            connections.set(connection.id, { ...connection });
            return true;
        },
        async update(update) {
            const existing = connections.get(update.id);
            if (!existing || existing.revision !== update.expectedRevision) return false;
            // Identity fields are intentionally not part of an update.
            connections.set(update.id, {
                ...existing,
                revision: update.revision,
                updatedAt: update.updatedAt,
                secretCiphertext: update.secretCiphertext,
                scopes: update.scopes === undefined ? existing.scopes : [...update.scopes],
                label: update.label === undefined ? existing.label : update.label,
            });
            return true;
        },
        async delete(id) {
            connections.delete(id);
            evidence.delete(id);
        },
        async getTestEvidence(connectionId) {
            return evidence.get(connectionId) ?? null;
        },
        async setTestEvidence(entry) {
            const connection = connections.get(entry.connectionId);
            // Evidence only counts for the revision that is current right now.
            if (!connection || connection.revision !== entry.revision) return false;
            const existing = evidence.get(entry.connectionId);
            // A higher revision always wins (a rotation invalidates evidence even
            // if clocks disagree); within a revision, a newer completion wins.
            if (existing) {
                if (existing.revision > entry.revision) return false;
                if (
                    existing.revision === entry.revision &&
                    existing.checkedAt > entry.checkedAt
                ) {
                    return false;
                }
            }
            evidence.set(entry.connectionId, { ...entry });
            return true;
        },
    };
}
