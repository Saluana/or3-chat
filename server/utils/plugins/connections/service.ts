/**
 * Plugin connection service.
 *
 * Owns the host side of connections: owner/workspace/plugin-scoped records,
 * opaque references, revision bumps that invalidate test evidence, and secret
 * decryption at the last moment. Secrets are never returned to callers.
 */

import {
    connectionRefFor,
    parseConnectionRef,
    type ConnectionFailureCode,
    type ConnectionRef,
    type ConnectionTestEvidence,
    type PluginConnectionView,
    type StoredPluginConnection,
} from '~~/shared/plugins/connections/contracts';
import { encryptConnectionSecret, decryptConnectionSecret } from './crypto';
import type { PluginConnectionStore } from './store/registry';

export interface ConnectionServiceOptions {
    readonly store: PluginConnectionStore;
    /** Encryption key from the environment/secret store, never the database. */
    readonly secret: string | undefined;
    readonly now?: () => number;
    readonly generateId?: () => string;
}

export type ConnectionServiceFailure = {
    readonly status: 'denied';
    readonly code:
        | 'connection-not-found'
        | 'connection-foreign'
        | 'reference-malformed'
        | 'reference-stale'
        | 'secret-unavailable'
        | 'invalid-input'
        /** A concurrent writer won; the caller may retry the request. */
        | 'conflict';
    readonly message: string;
};

/** Bounded retries: an id collision or a lost compare-and-swap is transient. */
const MAX_WRITE_ATTEMPTS = 3;

export type CreateConnectionResult =
    | { readonly status: 'created'; readonly view: PluginConnectionView; readonly secret: string }
    | ConnectionServiceFailure;

/**
 * Connection ids are random, not counter-based: two processes (or two
 * workspaces) generating at the same moment must never produce the same id,
 * because a collision would upsert one owner's connection over another's.
 * The alphabet matches `CONNECTION_REF_PATTERN` (`[A-Za-z0-9]`).
 */
function defaultId(): string {
    // Typed local: the guard is a runtime fact on older runtimes, not a type-level
    // possibility, so optional chaining would only hide the intent.
    const cryptoApi = globalThis.crypto as Crypto | undefined;
    if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
        return cryptoApi.randomUUID().replace(/-/g, '').slice(0, 32);
    }
    let fallback = '';
    for (let index = 0; index < 32; index += 1) {
        fallback += Math.floor(Math.random() * 16).toString(16);
    }
    return fallback;
}

export class PluginConnectionService {
    readonly #store: PluginConnectionStore;
    readonly #secret: string | undefined;
    readonly #now: () => number;
    readonly #generateId: () => string;

    constructor(options: ConnectionServiceOptions) {
        this.#store = options.store;
        this.#secret = options.secret;
        this.#now = options.now ?? (() => Date.now());
        this.#generateId = options.generateId ?? (() => defaultId());
    }

    /** True when credentials can be encrypted at all. */
    get available(): boolean {
        return Boolean(this.#secret && this.#secret.trim());
    }

    /**
     * List the acting owner's connections in one workspace. Ownership is part of
     * the query, not a post-filter: another workspace editor must not learn the
     * existence or references of someone else's connections.
     */
    async list(input: {
        readonly ownerUserId: string;
        readonly workspaceId: string;
        readonly pluginId?: string;
    }): Promise<readonly PluginConnectionView[]> {
        const connections = await this.#store.list(input);
        const views: PluginConnectionView[] = [];
        for (const connection of connections) {
            views.push(await this.#toView(connection));
        }
        return views;
    }

    async create(input: {
        readonly ownerUserId: string;
        readonly workspaceId: string;
        readonly pluginId: string;
        readonly providerId: string;
        /** Declared package slot this credential satisfies, when there is one. */
        readonly slotId?: string;
        readonly label: string;
        readonly scopes: readonly string[];
        readonly credential: string;
    }): Promise<CreateConnectionResult> {
        if (!this.available) {
            return {
                status: 'denied',
                code: 'secret-unavailable',
                message:
                    'OR3_PLUGIN_CONNECTION_SECRET is not configured; credentials cannot be stored',
            };
        }
        if (!input.credential || input.credential.trim().length === 0) {
            return {
                status: 'denied',
                code: 'invalid-input',
                message: 'A credential value is required',
            };
        }

        const now = this.#now();
        const secretCiphertext = encryptConnectionSecret(input.credential, this.#secret);
        // Insert-only creation: a generated id that already exists fails the
        // insert instead of overwriting someone else's record, so a collision is
        // retried with a fresh id rather than repaired with an upsert.
        for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
            const connection: StoredPluginConnection = {
                id: this.#generateId(),
                ownerUserId: input.ownerUserId,
                workspaceId: input.workspaceId,
                pluginId: input.pluginId,
                providerId: input.providerId,
                ...(input.slotId === undefined ? {} : { slotId: input.slotId }),
                label: input.label,
                scopes: [...input.scopes],
                revision: 1,
                secretCiphertext,
                createdAt: now,
                updatedAt: now,
            };
            if (await this.#store.insert(connection)) {
                return {
                    status: 'created',
                    view: await this.#toView(connection),
                    secret: input.credential,
                };
            }
        }
        return {
            status: 'denied',
            code: 'conflict',
            message: 'Could not allocate a unique connection id; retry the request',
        };
    }

    /**
     * Replace the credential. The revision advances so any earlier successful
     * test is invalidated, and a stale reference stops resolving.
     */
    async rotate(input: {
        readonly connectionId: string;
        readonly ownerUserId: string;
        readonly credential: string;
        readonly scopes?: readonly string[];
    }): Promise<CreateConnectionResult> {
        if (!this.available) {
            return {
                status: 'denied',
                code: 'secret-unavailable',
                message:
                    'OR3_PLUGIN_CONNECTION_SECRET is not configured; credentials cannot be stored',
            };
        }
        if (!input.credential || input.credential.trim().length === 0) {
            return {
                status: 'denied',
                code: 'invalid-input',
                message: 'A credential value is required',
            };
        }

        const secretCiphertext = encryptConnectionSecret(input.credential, this.#secret);
        // Compare-and-swap on the revision that was read: two concurrent
        // rotations must not share a revision, or the first credential's test
        // evidence would appear to vouch for the second credential.
        for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
            const existing = await this.#store.get(input.connectionId);
            if (!existing) {
                return {
                    status: 'denied',
                    code: 'connection-not-found',
                    message: 'Connection not found',
                };
            }
            if (existing.ownerUserId !== input.ownerUserId) {
                return {
                    status: 'denied',
                    code: 'connection-foreign',
                    message: 'Connection belongs to another user',
                };
            }
            const revision = existing.revision + 1;
            const updatedAt = this.#now();
            const next: StoredPluginConnection = {
                ...existing,
                scopes: input.scopes === undefined ? existing.scopes : [...input.scopes],
                revision,
                secretCiphertext,
                updatedAt,
            };
            const swapped = await this.#store.update({
                id: existing.id,
                expectedRevision: existing.revision,
                revision,
                updatedAt,
                secretCiphertext,
                ...(input.scopes === undefined ? {} : { scopes: [...input.scopes] }),
            });
            if (!swapped) continue;

            // A credential change invalidates the previous test evidence. The
            // write is bound to the revision that just became current, so a test
            // finishing late cannot reinstate the old revision's evidence.
            await this.#store.setTestEvidence({
                connectionId: next.id,
                revision,
                operationId: 'invalidated',
                ok: false,
                code: 'bad-credentials',
                checkedAt: this.#now(),
                detail: 'Credential changed; re-test required',
            });
            return {
                status: 'created',
                view: await this.#toView(next),
                secret: input.credential,
            };
        }
        return {
            status: 'denied',
            code: 'conflict',
            message: 'Credential rotation conflicted with a concurrent change; retry the request',
        };
    }

    async delete(input: {
        readonly connectionId: string;
        readonly ownerUserId: string;
    }): Promise<{ readonly status: 'deleted' } | ConnectionServiceFailure> {
        const existing = await this.#store.get(input.connectionId);
        if (!existing) {
            return {
                status: 'denied',
                code: 'connection-not-found',
                message: 'Connection not found',
            };
        }
        if (existing.ownerUserId !== input.ownerUserId) {
            return {
                status: 'denied',
                code: 'connection-foreign',
                message: 'Connection belongs to another user',
            };
        }
        await this.#store.delete(existing.id);
        return { status: 'deleted' };
    }

    /**
     * Resolve an opaque reference for one plugin in one workspace.
     * A caller cannot name another plugin's connection, and a stale revision is
     * refused rather than silently upgraded.
     */
    async resolve(input: {
        readonly ref: ConnectionRef;
        readonly pluginId: string;
        readonly workspaceId: string;
        /** Acting owner; a workspace peer is not the owner of this connection. */
        readonly ownerUserId: string;
    }): Promise<
        | { readonly status: 'resolved'; readonly connection: StoredPluginConnection }
        | ConnectionServiceFailure
    > {
        const parsed = parseConnectionRef(input.ref);
        if (!parsed) {
            return {
                status: 'denied',
                code: 'reference-malformed',
                message: 'Connection reference is malformed',
            };
        }
        const connection = await this.#store.get(parsed.id);
        if (!connection) {
            return {
                status: 'denied',
                code: 'connection-not-found',
                message: 'Connection not found',
            };
        }
        if (
            connection.pluginId !== input.pluginId ||
            connection.workspaceId !== input.workspaceId
        ) {
            return {
                status: 'denied',
                code: 'connection-foreign',
                message: 'Connection belongs to another plugin or workspace',
            };
        }
        if (connection.ownerUserId !== input.ownerUserId) {
            return {
                status: 'denied',
                code: 'connection-foreign',
                message: 'Connection belongs to another owner',
            };
        }
        if (connection.revision !== parsed.revision) {
            return {
                status: 'denied',
                code: 'reference-stale',
                message: 'Connection reference is stale after a credential change',
            };
        }
        return { status: 'resolved', connection };
    }

    /** Decrypt at dispatch time only. Never log or return the result. */
    revealCredential(connection: StoredPluginConnection): string | null {
        try {
            return decryptConnectionSecret(connection.secretCiphertext, this.#secret);
        } catch {
            return null;
        }
    }

    /**
     * Records test evidence. `false` means the store refused it as stale: the
     * credential changed, or a newer result already exists for that revision.
     */
    async recordTest(evidence: ConnectionTestEvidence): Promise<boolean> {
        return await this.#store.setTestEvidence(evidence);
    }

    async testEvidence(connectionId: string): Promise<ConnectionTestEvidence | null> {
        return await this.#store.getTestEvidence(connectionId);
    }

    /**
     * Evidence counts only when it belongs to the current revision and passed.
     * A credential change therefore invalidates a previous success.
     */
    async isTestCurrent(connectionId: string): Promise<boolean> {
        const connection = await this.#store.get(connectionId);
        const evidence = await this.#store.getTestEvidence(connectionId);
        return Boolean(
            connection && evidence && evidence.revision === connection.revision && evidence.ok
        );
    }

    async markTestFailure(
        connectionId: string,
        operationId: string,
        code: ConnectionFailureCode,
        detail?: string
    ): Promise<void> {
        const connection = await this.#store.get(connectionId);
        if (!connection) return;
        await this.#store.setTestEvidence({
            connectionId,
            revision: connection.revision,
            operationId,
            ok: false,
            code,
            checkedAt: this.#now(),
            ...(detail === undefined ? {} : { detail }),
        });
    }

    async #toView(connection: StoredPluginConnection): Promise<PluginConnectionView> {
        const evidence = await this.#store.getTestEvidence(connection.id);
        const current = evidence && evidence.revision === connection.revision ? evidence : undefined;
        return Object.freeze({
            id: connection.id,
            ref: connectionRefFor(connection.id, connection.revision),
            pluginId: connection.pluginId,
            workspaceId: connection.workspaceId,
            providerId: connection.providerId,
            ...(connection.slotId === undefined ? {} : { slotId: connection.slotId }),
            label: connection.label,
            scopes: [...connection.scopes],
            revision: connection.revision,
            createdAt: connection.createdAt,
            updatedAt: connection.updatedAt,
            ...(current === undefined ? {} : { lastTest: current }),
        });
    }
}
