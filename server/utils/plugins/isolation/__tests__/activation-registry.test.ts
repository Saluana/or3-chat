import { beforeEach, describe, expect, it } from 'vitest';
import type { PluginGrantReviewSnapshot } from '~~/shared/plugins/grant-review';
import {
    clearHostActivationsForTests,
    registerHostActivation,
    resolveHostActivation,
    revokeHostActivation,
    revokeHostActivationsForPlugin,
    revokeHostActivationsForPluginWorkspace,
    revokeHostActivationsForUser,
    revokeHostActivationsForUserWorkspace,
    revokeHostActivationsForWorkspace,
} from '../activation-registry';
import {
    clearAllActivationAdmissionsForTests,
    getActivationAdmissionStats,
    tryAdmitActivationCall,
} from '../activation-admission';

function grants(): PluginGrantReviewSnapshot {
    return {
        requestedGrants: ['network.http'],
        approvedGrants: ['network.http'],
        revision: 'g1',
        status: 'current',
        authoritySha256: null,
        packageDigest: 'sha256-test',
    };
}

function mint(input: {
    readonly pluginId?: string;
    readonly workspaceId?: string;
    readonly userId?: string;
    readonly ttlMs?: number;
}) {
    return registerHostActivation({
        pluginId: input.pluginId ?? 'example.plugin',
        workspaceId: input.workspaceId ?? 'ws-1',
        userId: input.userId ?? 'user-1',
        packageDigest: 'sha256-test',
        grants: grants(),
        ...(input.ttlMs === undefined ? {} : { ttlMs: input.ttlMs }),
    });
}

/**
 * Activation lifecycle (workstream 3): stale handles fail closed, teardown
 * aborts in-flight capability work, and scope revocation covers disable,
 * update, workspace switch and logout.
 */
describe('host activation registry lifecycle', () => {
    beforeEach(() => {
        clearHostActivationsForTests();
        clearAllActivationAdmissionsForTests();
    });

    it('aborts in-flight calls when the activation is revoked mid-call', () => {
        const record = mint({});
        const admitted = tryAdmitActivationCall(record.activationId, {
            requestId: 'rpc-1',
            method: 'ai.complete',
            params: {},
        });
        expect(admitted.ok).toBe(true);
        let aborted = false;
        if (admitted.ok) {
            admitted.controller.signal.addEventListener('abort', () => {
                aborted = true;
            });
        }

        expect(revokeHostActivation(record.activationId, 'plugin-disabled')).toBe(true);
        expect(aborted).toBe(true);
        expect(getActivationAdmissionStats(record.activationId)).toMatchObject({
            inFlight: 0,
            seen: 0,
        });
        expect(resolveHostActivation(record.activationId)).toMatchObject({
            ok: false,
            code: 'activation-revoked',
        });
    });

    it('clears admission state when an activation expires', () => {
        const record = mint({ ttlMs: -1 });
        // Seed admission state before the expiry is observed.
        const admitted = tryAdmitActivationCall(record.activationId, {
            requestId: 'rpc-1',
            method: 'ai.models',
            params: {},
        });
        expect(admitted.ok).toBe(true);

        expect(resolveHostActivation(record.activationId)).toMatchObject({
            ok: false,
            code: 'activation-expired',
        });
        expect(getActivationAdmissionStats(record.activationId)).toMatchObject({
            inFlight: 0,
            seen: 0,
        });
    });

    it('forgets handles on restart (clear) so stale calls fail closed', () => {
        const record = mint({});
        clearHostActivationsForTests();
        expect(resolveHostActivation(record.activationId)).toMatchObject({
            ok: false,
            code: 'activation-unknown',
        });
    });

    it('revokes one plugin everywhere on package promotion', () => {
        const first = mint({ pluginId: 'a.plugin', workspaceId: 'ws-1' });
        const second = mint({ pluginId: 'a.plugin', workspaceId: 'ws-2' });
        const other = mint({ pluginId: 'b.plugin', workspaceId: 'ws-1' });

        const revoked = revokeHostActivationsForPlugin(
            'a.plugin',
            'selected-package-changed'
        );
        expect(new Set(revoked)).toEqual(
            new Set([first.activationId, second.activationId])
        );
        expect(resolveHostActivation(first.activationId)).toMatchObject({
            ok: false,
            code: 'activation-revoked',
        });
        expect(resolveHostActivation(second.activationId)).toMatchObject({
            ok: false,
            code: 'activation-revoked',
        });
        expect(resolveHostActivation(other.activationId).ok).toBe(true);
    });

    it('revokes one plugin in one workspace on disable', () => {
        const disabled = mint({ pluginId: 'a.plugin', workspaceId: 'ws-1' });
        const samePluginOtherWorkspace = mint({
            pluginId: 'a.plugin',
            workspaceId: 'ws-2',
        });
        const otherPlugin = mint({ pluginId: 'b.plugin', workspaceId: 'ws-1' });

        revokeHostActivationsForPluginWorkspace('a.plugin', 'ws-1', 'plugin-disabled');
        expect(resolveHostActivation(disabled.activationId)).toMatchObject({
            ok: false,
            code: 'activation-revoked',
        });
        expect(resolveHostActivation(samePluginOtherWorkspace.activationId).ok).toBe(true);
        expect(resolveHostActivation(otherPlugin.activationId).ok).toBe(true);
    });

    it('revokes one user in one workspace on switch without stopping others', () => {
        const leaver = mint({ workspaceId: 'ws-1', userId: 'user-1' });
        const sameWorkspaceOtherUser = mint({ workspaceId: 'ws-1', userId: 'user-2' });
        const sameUserOtherWorkspace = mint({ workspaceId: 'ws-2', userId: 'user-1' });

        revokeHostActivationsForUserWorkspace('user-1', 'ws-1', 'workspace-switch');
        expect(resolveHostActivation(leaver.activationId)).toMatchObject({
            ok: false,
            code: 'activation-revoked',
        });
        expect(resolveHostActivation(sameWorkspaceOtherUser.activationId).ok).toBe(true);
        expect(resolveHostActivation(sameUserOtherWorkspace.activationId).ok).toBe(true);
    });

    it('revokes a whole workspace and a whole user', () => {
        const switched = mint({ workspaceId: 'ws-1', userId: 'user-1' });
        const otherWorkspace = mint({ workspaceId: 'ws-2', userId: 'user-1' });
        revokeHostActivationsForWorkspace('ws-1', 'workspace-switch');
        expect(resolveHostActivation(switched.activationId)).toMatchObject({
            ok: false,
            code: 'activation-revoked',
        });
        expect(resolveHostActivation(otherWorkspace.activationId).ok).toBe(true);

        const loggedOut = mint({ workspaceId: 'ws-2', userId: 'user-1' });
        const otherUser = mint({ workspaceId: 'ws-2', userId: 'user-2' });
        revokeHostActivationsForUser('user-1', 'logout');
        expect(resolveHostActivation(loggedOut.activationId)).toMatchObject({
            ok: false,
            code: 'activation-revoked',
        });
        expect(resolveHostActivation(otherUser.activationId).ok).toBe(true);
    });
});
