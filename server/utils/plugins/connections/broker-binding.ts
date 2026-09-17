/**
 * Sandbox-facing connection dispatch.
 *
 * Builds the host RPC method a portable plugin calls to run an approved
 * operation. Identity comes from the broker context (host-created), never from
 * plugin parameters, and the reference is resolved against the plugin's own
 * owner + workspace records.
 *
 * The handler is bound to an immutable release-authority snapshot: the package's
 * approved operations/destinations/scopes, the stored connection scopes, the
 * acting owner, and a host-minted approval for any operation the provider
 * classifies as external, commercial, destructive or access-changing.
 */

import type { HostRpcMethodSpec } from '~~/shared/plugins/isolation/host-rpc-broker';
import type { ConnectionDispatchPolicy } from '~~/shared/plugins/connections/contracts';
import { listConnectionProviders } from './providers/registry';
import { dispatchApprovedConnectionOperation } from './dispatch';
import { PluginConnectionService } from './service';
import { createFetchConnectionTransport } from './transport';

export const CONNECTIONS_DISPATCH_METHOD = 'connections.dispatch';

export type ConnectionDispatchParams = {
    readonly ref?: unknown;
    readonly operationId?: unknown;
    readonly url?: unknown;
    readonly method?: unknown;
    readonly headers?: unknown;
    readonly body?: unknown;
};

/**
 * Host-side approval lookup. The plugin never supplies an approval: the host UI
 * mints one for a specific target and the handler consumes it here.
 */
export interface HostApprovalPort {
    take(input: {
        readonly pluginId: string;
        readonly workspaceId: string;
        readonly generation: number;
        readonly target: string;
    }): unknown | undefined;
}

function readString(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.length === 0) {
        throw Object.assign(new Error(`${field} is required`), { rpcCode: 'policy-denied' });
    }
    return value;
}

function readHeaders(value: unknown): Record<string, string> | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw Object.assign(new Error('headers must be an object'), { rpcCode: 'policy-denied' });
    }
    const headers: Record<string, string> = {};
    for (const [key, headerValue] of Object.entries(value)) {
        if (typeof headerValue !== 'string') {
            throw Object.assign(new Error(`header ${key} must be a string`), {
                rpcCode: 'policy-denied',
            });
        }
        headers[key] = headerValue;
    }
    return headers;
}

/**
 * Build the `connections.dispatch` method spec bound to one connection service.
 * The returned handler never accepts plugin, workspace, owner, credential or
 * approval values from its parameters.
 */
export function createConnectionDispatchMethod(input: {
    readonly service: PluginConnectionService;
    /** Immutable release authority; without it only read-only operations run. */
    readonly policy?: ConnectionDispatchPolicy | null;
    readonly approvals?: HostApprovalPort;
    /**
     * Current-user permission check. When absent, only read-only operations are
     * allowed: an operation that changes anything needs an explicit permission
     * source rather than being assumed allowed.
     */
    readonly assertPermission?: (input: {
        readonly pluginId: string;
        readonly workspaceId: string;
        readonly userId: string;
        readonly operationId: string;
    }) => boolean;
    readonly transport?: ReturnType<typeof createFetchConnectionTransport>;
}): HostRpcMethodSpec {
    const transport = input.transport ?? createFetchConnectionTransport();

    return {
        method: CONNECTIONS_DISPATCH_METHOD,
        grant: 'network.http',
        handler: async (params, context) => {
            const typed = params as ConnectionDispatchParams;
            const ref = readString(typed.ref, 'ref');
            const operationId = readString(typed.operationId, 'operationId');
            const url = readString(typed.url, 'url');
            const method = typeof typed.method === 'string' ? typed.method : undefined;
            const headers = readHeaders(typed.headers);
            if (typed.body !== undefined && typeof typed.body !== 'string') {
                throw Object.assign(new Error('body must be a string when present'), {
                    rpcCode: 'policy-denied',
                });
            }

            // Host-created identity only. A plugin cannot name another plugin,
            // workspace or owner, and cannot supply its own approval.
            const userId = context.userId;
            if (!userId) {
                throw Object.assign(
                    new Error('Connection dispatch requires a host-resolved acting user'),
                    { rpcCode: 'policy-denied' }
                );
            }
            const resolved = await input.service.resolve({
                ref,
                pluginId: context.pluginId,
                workspaceId: context.workspaceId,
                ownerUserId: userId,
            });
            if (resolved.status === 'denied') {
                throw Object.assign(new Error(resolved.message), { rpcCode: 'policy-denied' });
            }
            const connection = resolved.connection;
            const provider = listConnectionProviders().find(
                (candidate) => candidate.id === connection.providerId
            );
            if (!provider) {
                throw Object.assign(
                    new Error(`Unknown connection provider: ${connection.providerId}`),
                    { rpcCode: 'policy-denied' }
                );
            }

            const operation = provider.operations.find(
                (candidate) => candidate.id === operationId
            );
            if (!operation) {
                throw Object.assign(
                    new Error(`Provider ${provider.id} does not declare operation ${operationId}`),
                    { rpcCode: 'policy-denied' }
                );
            }

            // Current-user permission is checked before the credential is read.
            const permission = input.assertPermission ?? (() => operation.readOnly);
            if (
                !permission({
                    pluginId: context.pluginId,
                    workspaceId: context.workspaceId,
                    userId,
                    operationId,
                })
            ) {
                throw Object.assign(
                    new Error(`The acting user may not run operation ${operationId}`),
                    { rpcCode: 'policy-denied' }
                );
            }

            const approval = input.approvals?.take({
                pluginId: context.pluginId,
                workspaceId: context.workspaceId,
                generation: context.generation,
                target: `${provider.id}:${operation.id}`,
            });

            const credential = input.service.revealCredential(connection);
            if (credential === null) {
                throw Object.assign(new Error('Connection credential is unavailable'), {
                    rpcCode: 'policy-denied',
                });
            }

            const outcome = await dispatchApprovedConnectionOperation({
                provider,
                operationId,
                url,
                ...(method === undefined ? {} : { method }),
                ...(headers === undefined ? {} : { headers }),
                ...(typeof typed.body === 'string' ? { body: typed.body } : {}),
                grantedScopes: connection.scopes,
                credential,
                ...(input.policy === undefined ? {} : { policy: input.policy }),
                ...(approval === undefined ? {} : { approval }),
                pluginId: context.pluginId,
                workspaceId: context.workspaceId,
                generation: context.generation,
                transport,
                signal: context.signal,
                timeoutMs: context.deadlineMs,
            });

            if (outcome.status === 'denied') {
                throw Object.assign(new Error(outcome.message), {
                    rpcCode: 'policy-denied',
                });
            }
            if (outcome.status === 'failed') {
                // The typed failure is returned as data so the plugin can show it;
                // no credential and no unapproved detail is included.
                return {
                    ok: false,
                    operationId: outcome.operationId,
                    code: outcome.code,
                    message: outcome.message,
                };
            }
            return { ok: true, operationId: outcome.operationId, response: outcome.response };
        },
    };
}
