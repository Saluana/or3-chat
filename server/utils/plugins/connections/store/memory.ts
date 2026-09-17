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
        async upsert(connection) {
            connections.set(connection.id, { ...connection });
        },
        async delete(id) {
            connections.delete(id);
            evidence.delete(id);
        },
        async getTestEvidence(connectionId) {
            return evidence.get(connectionId) ?? null;
        },
        async setTestEvidence(entry) {
            evidence.set(entry.connectionId, { ...entry });
        },
    };
}
