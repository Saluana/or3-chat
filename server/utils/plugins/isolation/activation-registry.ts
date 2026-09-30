/**
 * @module server/utils/plugins/isolation/activation-registry
 *
 * Purpose:
 * Server-minted activation handles for the portable capability bridge. A
 * sandbox never nominates a plugin, workspace, user, generation, package digest
 * or grant list: the host mints an opaque handle for one resolved activation
 * and the capability route re-derives every identity from the record.
 *
 * Behavior:
 * - A handle is registered only after the host has re-checked the plugin's
 *   installed/enabled/access state and resolved the current package digest and
 *   its approved grant review. Those values are sealed into the record.
 * - The generated `generation` is server-assigned and monotonic, so a client
 *   cannot rotate it to reset a spend ledger or replay an earlier identity.
 * - Resolution is fail-closed: unknown, expired and revoked handles are denied
 *   with their own code, and revocation releases the selection authority that
 *   was minted with the record.
 * - The map is in-memory and bounded. A restart forgets handles, so a new
 *   activation must be minted rather than reusing a stale one.
 * - Teardown (revoke, expiry, eviction, disable, update, workspace switch,
 *   logout) also aborts the activation's in-flight capability calls and forgets
 *   its replay history, so a stale handle leaves no runnable work behind.
 *
 * Non-Goals:
 * - Grant evaluation per method (the `HostRpcBroker` owns that).
 * - Deciding whether an activation may start (the mint route owns that).
 * - Cross-process coordination. The launch topology is a single Node process
 *   per host; handles and admission state are process-local by design.
 */

import { randomBytes } from 'node:crypto';
import type { PluginGrantReviewSnapshot } from '~~/shared/plugins/grant-review';
import {
    abortActivationCalls,
    clearAllActivationAdmissionsForTests,
} from './activation-admission';
import {
    releaseSelectionAuthority,
    retainSelectionAuthority,
} from '../setup/selection-authority-registry';

export interface HostActivationRecord {
    readonly activationId: string;
    readonly pluginId: string;
    readonly workspaceId: string;
    readonly userId: string;
    /** Server-assigned generation; never read from a caller. */
    readonly generation: number;
    /** Digest of the exact selected package this activation may run. */
    readonly packageDigest: string | null;
    /** The approved review the activation was minted against. */
    readonly grants: PluginGrantReviewSnapshot;
    readonly issuedAt: number;
    readonly expiresAt: number;
    readonly revoked: string | null;
}

export type HostActivationResolution =
    | { readonly ok: true; readonly record: HostActivationRecord }
    | {
          readonly ok: false;
          readonly code:
              | 'activation-unknown'
              | 'activation-expired'
              | 'activation-revoked';
          readonly message: string;
      };

interface ActivationEntry {
    record: HostActivationRecord;
    revoked: string | null;
}

const activations = new Map<string, ActivationEntry>();
const MAX_ACTIVATIONS = 512;
export const DEFAULT_ACTIVATION_TTL_MS = 30 * 60 * 1000;

let generationCounter = 0;

function defaultActivationId(): string {
    return `act_${randomBytes(24).toString('hex')}`;
}

function bound(): void {
    while (activations.size > MAX_ACTIVATIONS) {
        const oldest = activations.keys().next().value;
        if (typeof oldest !== 'string') return;
        const entry = activations.get(oldest);
        if (entry) {
            releaseSelectionAuthority(
                entry.record.pluginId,
                entry.record.workspaceId,
                entry.record.generation
            );
        }
        abortActivationCalls(oldest, 'activation-evicted');
        activations.delete(oldest);
    }
}

/**
 * Mint one activation. The caller has already verified that the plugin is
 * installed, enabled and usable, and has resolved the digest and approved
 * review this activation runs against; the record seals those values so the
 * capability route never has to trust the sandbox for them.
 */
export function registerHostActivation(input: {
    readonly pluginId: string;
    readonly workspaceId: string;
    readonly userId: string;
    readonly packageDigest: string | null;
    readonly grants: PluginGrantReviewSnapshot;
    readonly ttlMs?: number;
    readonly now?: () => number;
    readonly generateActivationId?: () => string;
}): HostActivationRecord {
    const now = input.now ?? (() => Date.now());
    generationCounter += 1;
    const issuedAt = now();
    const record: HostActivationRecord = {
        activationId: (input.generateActivationId ?? defaultActivationId)(),
        pluginId: input.pluginId,
        workspaceId: input.workspaceId,
        userId: input.userId,
        generation: generationCounter,
        packageDigest: input.packageDigest,
        grants: input.grants,
        issuedAt,
        expiresAt: issuedAt + (input.ttlMs ?? DEFAULT_ACTIVATION_TTL_MS),
        revoked: null,
    };
    activations.set(record.activationId, { record, revoked: null });
    // The handle and the selection authority are minted together at the same
    // server generation, so a first-action handoff can only resolve a handle
    // into an activation the server itself registered.
    retainSelectionAuthority({
        pluginId: record.pluginId,
        workspaceId: record.workspaceId,
        generation: record.generation,
        now,
    });
    bound();
    return record;
}

/** Resolve a handle to its sealed record, or deny with a precise code. */
export function resolveHostActivation(
    activationId: string,
    options: { readonly now?: () => number } = {}
): HostActivationResolution {
    const entry = activations.get(activationId);
    if (!entry) {
        return {
            ok: false,
            code: 'activation-unknown',
            message: 'This activation was not minted by this host',
        };
    }
    if (entry.revoked !== null) {
        return {
            ok: false,
            code: 'activation-revoked',
            message: `Activation was revoked: ${entry.revoked}`,
        };
    }
    if ((options.now ?? (() => Date.now()))() > entry.record.expiresAt) {
        // Expiry is teardown too: a stale handle must not keep the selection
        // authority that lets first-action handoff mint a live-looking handle,
        // nor any in-flight capability work.
        entry.revoked = 'expired';
        releaseSelectionAuthority(
            entry.record.pluginId,
            entry.record.workspaceId,
            entry.record.generation
        );
        abortActivationCalls(activationId, 'expired');
        return {
            ok: false,
            code: 'activation-expired',
            message: 'Activation has expired; start the plugin again',
        };
    }
    return { ok: true, record: entry.record };
}

/** Revoke one handle (stale digest, disable, teardown) and drop its authority. */
export function revokeHostActivation(activationId: string, reason: string): boolean {
    const entry = activations.get(activationId);
    if (!entry) return false;
    entry.revoked = reason;
    releaseSelectionAuthority(
        entry.record.pluginId,
        entry.record.workspaceId,
        entry.record.generation
    );
    // Mid-call revocation aborts in-flight work; the capability route releases
    // its admission slot when the broker settles as cancelled.
    abortActivationCalls(activationId, reason);
    return true;
}

/**
 * Revoke every activation matching a lifecycle scope. Used proactively on
 * disable, package promotion/uninstall, workspace switch and logout so
 * in-flight calls are aborted instead of running to completion on stale
 * authority. Returns the revoked handles.
 */
export function revokeHostActivationsMatching(
    predicate: (record: HostActivationRecord) => boolean,
    reason: string
): readonly string[] {
    const revoked: string[] = [];
    for (const [activationId, entry] of activations) {
        if (entry.revoked !== null) continue;
        if (!predicate(entry.record)) continue;
        revokeHostActivation(activationId, reason);
        revoked.push(activationId);
    }
    return revoked;
}

/** Revoke every live activation for one plugin (package promotion/uninstall). */
export function revokeHostActivationsForPlugin(pluginId: string, reason: string): readonly string[] {
    return revokeHostActivationsMatching((record) => record.pluginId === pluginId, reason);
}

/** Revoke every live activation for one plugin in one workspace (disable). */
export function revokeHostActivationsForPluginWorkspace(
    pluginId: string,
    workspaceId: string,
    reason: string
): readonly string[] {
    return revokeHostActivationsMatching(
        (record) => record.pluginId === pluginId && record.workspaceId === workspaceId,
        reason
    );
}

/** Revoke every live activation in one workspace (workspace switch). */
export function revokeHostActivationsForWorkspace(
    workspaceId: string,
    reason: string
): readonly string[] {
    return revokeHostActivationsMatching(
        (record) => record.workspaceId === workspaceId,
        reason
    );
}

/**
 * Revoke one user's live activations in one workspace. This is the switch
 * scope: a workspace-wide revocation would stop other users sharing the
 * workspace the switcher is leaving.
 */
export function revokeHostActivationsForUserWorkspace(
    userId: string,
    workspaceId: string,
    reason: string
): readonly string[] {
    return revokeHostActivationsMatching(
        (record) => record.userId === userId && record.workspaceId === workspaceId,
        reason
    );
}

/** Revoke every live activation for one user (logout). */
export function revokeHostActivationsForUser(userId: string, reason: string): readonly string[] {
    return revokeHostActivationsMatching((record) => record.userId === userId, reason);
}

/** Test helper: forget every minted activation between cases. */
export function clearHostActivationsForTests(): void {
    for (const entry of activations.values()) {
        releaseSelectionAuthority(
            entry.record.pluginId,
            entry.record.workspaceId,
            entry.record.generation
        );
    }
    activations.clear();
    clearAllActivationAdmissionsForTests();
    generationCounter = 0;
}
