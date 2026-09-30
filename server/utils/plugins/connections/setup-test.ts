/**
 * Connection setup tests.
 *
 * Runs one bounded, approved, idempotent operation against a stored connection,
 * classifies the outcome into a typed failure the UI can act on, and records
 * revision-bound evidence. Non-idempotent operations are refused outright so a
 * test can never perform a real write.
 */

import type {
    ConnectionDispatchPolicy,
    ConnectionFailureCode,
    ConnectionProviderDescriptor,
    ConnectionTestEvidence,
} from '~~/shared/plugins/connections/contracts';
import type { PluginConnectionService } from './service';
import {
    dispatchApprovedConnectionOperation,
    type ConnectionTransport,
} from './dispatch';

export const DEFAULT_SETUP_TEST_DEADLINE_MS = 8_000;

export type SetupTestResult =
    | {
          readonly status: 'ok';
          readonly operationId: string;
          readonly evidence: ConnectionTestEvidence;
          readonly response: unknown;
      }
    | {
          readonly status: 'failed';
          readonly operationId: string;
          readonly code: ConnectionFailureCode;
          readonly message: string;
          readonly evidence: ConnectionTestEvidence;
      }
    | {
          readonly status: 'denied';
          readonly code: string;
          readonly message: string;
      };

/** A setup test must be read-only and idempotent; anything else is refused. */
export function isTestableOperation(
    provider: ConnectionProviderDescriptor,
    operationId: string
): { readonly ok: true } | { readonly ok: false; readonly message: string } {
    const operation = provider.operations.find((candidate) => candidate.id === operationId);
    if (!operation) {
        return { ok: false, message: `Provider ${provider.id} has no operation ${operationId}` };
    }
    if (!operation.readOnly) {
        return {
            ok: false,
            message: `Operation ${operationId} is not read-only and cannot be used as a setup test`,
        };
    }
    if (!operation.idempotent) {
        return {
            ok: false,
            message: `Operation ${operationId} is not idempotent and cannot be used as a setup test`,
        };
    }
    return { ok: true };
}

export async function runConnectionSetupTest(input: {
    readonly service: PluginConnectionService;
    readonly provider: ConnectionProviderDescriptor;
    readonly ref: string;
    readonly pluginId: string;
    readonly workspaceId: string;
    /** Acting owner; the test path is owner-scoped like dispatch. */
    readonly ownerUserId: string;
    readonly operationId: string;
    readonly url: string;
    readonly transport: ConnectionTransport;
    /** Release-approved connection policy, when the package declares one. */
    readonly policy?: ConnectionDispatchPolicy | null;
    readonly deadlineMs?: number;
    readonly now?: () => number;
    readonly signal?: AbortSignal;
}): Promise<SetupTestResult> {
    const now = input.now ?? (() => Date.now());
    const testable = isTestableOperation(input.provider, input.operationId);
    if (!testable.ok) {
        return { status: 'denied', code: 'operation-not-testable', message: testable.message };
    }

    const resolved = await input.service.resolve({
        ref: input.ref,
        pluginId: input.pluginId,
        workspaceId: input.workspaceId,
        ownerUserId: input.ownerUserId,
    });
    if (resolved.status === 'denied') {
        return { status: 'denied', code: resolved.code, message: resolved.message };
    }
    const connection = resolved.connection;

    const credential = input.service.revealCredential(connection);
    if (credential === null) {
        const evidence: ConnectionTestEvidence = {
            connectionId: connection.id,
            revision: connection.revision,
            operationId: input.operationId,
            ok: false,
            code: 'unknown',
            checkedAt: now(),
            detail: 'Stored credential could not be decrypted',
        };
        await input.service.recordTest(evidence);
        return {
            status: 'failed',
            operationId: input.operationId,
            code: 'unknown',
            message: evidence.detail ?? 'Credential unavailable',
            evidence,
        };
    }

    const deadlineMs = input.deadlineMs ?? DEFAULT_SETUP_TEST_DEADLINE_MS;
    const controller = input.signal ? null : new AbortController();
    const signal = input.signal ?? controller?.signal;

    const outcome = await dispatchApprovedConnectionOperation({
        provider: input.provider,
        operationId: input.operationId,
        url: input.url,
        grantedScopes: connection.scopes,
        credential,
        ...(input.policy === undefined ? {} : { policy: input.policy }),
        pluginId: input.pluginId,
        workspaceId: input.workspaceId,
        ...(input.now === undefined ? {} : { now: input.now }),
        ...(input.provider.credentialHeader === undefined
            ? {}
            : { credentialHeader: input.provider.credentialHeader }),
        ...(input.provider.credentialPrefix === undefined
            ? {}
            : { credentialPrefix: input.provider.credentialPrefix }),
        transport: input.transport,
        timeoutMs: deadlineMs,
        ...(signal === undefined ? {} : { signal }),
    });

    if (outcome.status === 'denied') {
        return { status: 'denied', code: outcome.code, message: outcome.message };
    }

    const evidence: ConnectionTestEvidence = {
        connectionId: connection.id,
        revision: connection.revision,
        operationId: input.operationId,
        ok: outcome.status === 'ok',
        ...(outcome.status === 'ok' ? {} : { code: outcome.code }),
        checkedAt: now(),
        ...(outcome.status === 'ok' ? {} : { detail: outcome.message }),
    };
    await input.service.recordTest(evidence);

    if (outcome.status === 'ok') {
        return {
            status: 'ok',
            operationId: input.operationId,
            evidence,
            response: outcome.response.body,
        };
    }

    return {
        status: 'failed',
        operationId: input.operationId,
        code: outcome.code,
        message: outcome.message,
        evidence,
    };
}

/** UI copy per failure class; distinct causes are never conflated. */
export function describeConnectionFailure(code: ConnectionFailureCode): string {
    switch (code) {
        case 'bad-credentials':
            return 'The credential was rejected. Check the value and try again.';
        case 'insufficient-scope':
            return 'The credential is valid but lacks the scopes this plugin needs.';
        case 'network-failure':
            return 'The provider could not be reached. Check network access and the provider URL.';
        case 'rate-limit':
            return 'The provider rate-limited this request. Wait and retry.';
        case 'provider-outage':
            return 'The provider reported an internal error. This is usually temporary.';
        case 'deadline-exceeded':
            return 'The provider did not answer before the deadline.';
        case 'response-too-large':
            return 'The provider returned more data than this operation allows.';
        case 'policy-denied':
            return 'The request was refused by host policy (destination, headers or response safety).';
        case 'unknown':
            return 'The test failed for a reason the provider did not classify.';
        default: {
            const exhaustive: never = code;
            return `Unhandled failure code: ${String(exhaustive)}`;
        }
    }
}
