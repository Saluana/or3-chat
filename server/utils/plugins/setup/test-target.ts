/**
 * Server-side resolution of a connection setup test.
 *
 * The test operation and its URL come from the provider's approved operation and
 * the release's own policy, never from the caller: a hostname plus a package hook
 * cannot evidence anything about a credential. The URL is the operation's exact
 * declared target, which dispatch then re-validates against the release policy.
 */

import type {
    ConnectionProviderDescriptor,
} from '~~/shared/plugins/connections/contracts';
import type {
    Or3PackagePolicyV1,
    Or3SetupDescriptorV1,
} from '@or3/plugin-sdk/profile';
import { DEFAULT_SETUP_TEST_DEADLINE_MS, isTestableOperation } from '../connections/setup-test';

/** Upper bound for a package-declared deadline; a package cannot stall a request. */
export const MAX_SETUP_TEST_DEADLINE_MS = 30_000;

export interface ResolvedSetupTestTarget {
    readonly operationId: string;
    readonly url: string;
    readonly deadlineMs: number;
}

export type SetupTestTargetResolution =
    | { readonly ok: true; readonly target: ResolvedSetupTestTarget }
    | { readonly ok: false; readonly message: string };

export function resolveSetupTestTarget(input: {
    readonly setup: Or3SetupDescriptorV1;
    readonly policy: Or3PackagePolicyV1 | null;
    readonly provider: ConnectionProviderDescriptor;
    /** Declared package slot the credential is bound to. */
    readonly slotId: string | undefined;
}): SetupTestTargetResolution {
    const action = input.setup.testAction;
    if (!action) {
        return {
            ok: false,
            message: 'The package declares no setup test action for this connection',
        };
    }
    const testable = isTestableOperation(input.provider, action.operationId);
    if (!testable.ok) {
        return { ok: false, message: testable.message };
    }
    const operation = input.provider.operations.find(
        (candidate) => candidate.id === action.operationId
    );
    if (!operation) {
        return {
            ok: false,
            message: `Provider ${input.provider.id} has no operation ${action.operationId}`,
        };
    }

    if (input.slotId === undefined) {
        return {
            ok: false,
            message: 'This connection is not bound to a declared package connection slot',
        };
    }
    const declared = input.policy?.connections.find(
        (candidate) => candidate.id === input.slotId
    );
    if (!declared) {
        return {
            ok: false,
            message: `The package policy does not declare a connection named ${input.slotId}`,
        };
    }
    if (!declared.operations.includes(action.operationId)) {
        return {
            ok: false,
            message: `The release does not approve ${action.operationId} for ${input.slotId}`,
        };
    }
    if (declared.provider !== input.provider.id) {
        return {
            ok: false,
            message: `Connection slot ${input.slotId} belongs to provider ${declared.provider}`,
        };
    }

    const deadlineMs = Number.isFinite(action.deadlineMs)
        ? Math.min(Math.max(action.deadlineMs, 1_000), MAX_SETUP_TEST_DEADLINE_MS)
        : DEFAULT_SETUP_TEST_DEADLINE_MS;

    return {
        ok: true,
        target: {
            operationId: operation.id,
            // The approved operation's own target; the caller supplies nothing.
            url: `https://${operation.host}${operation.pathPrefix}`,
            deadlineMs,
        },
    };
}
