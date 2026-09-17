/**
 * @module shared/plugins/setup/plan
 *
 * Purpose:
 * Turn a package's generated `or3.setup.json` plus its `or3.package-policy.json`
 * connections into a host-rendered setup plan: what is required before the
 * plugin is useful, what may be deferred, and how to reach the first action.
 *
 * Behavior:
 * - Required settings and connections with no safe default block "ready";
 *   optional settings are deferred to after first use.
 * - A successful connection test is bound to the connection revision, so a
 *   credential change returns the plugin to "needs setup".
 * - `Needs setup` is never reported as `Ready`, and a package whose first action
 *   is unreachable is reported as blocked rather than ready.
 *
 * Constraints:
 * - Pure data: the host owns rendering and persistence.
 *
 * Non-Goals:
 * - Storing settings or secrets (host services own that).
 */

import type {
    Or3PackageConnection,
    Or3PackagePolicyV1,
    Or3SetupDescriptorV1,
    Or3SetupField,
    PortableProfileFieldValue,
} from '@or3/plugin-sdk/profile';

export type SetupStatus = 'ready' | 'needs-setup' | 'blocked';

export interface SetupFieldPlan {
    readonly key: string;
    readonly label: string;
    readonly kind: Or3SetupField['kind'];
    readonly order: number;
    readonly required: boolean;
    readonly deferred: boolean;
    readonly choices?: readonly string[];
    readonly defaultValue?: PortableProfileFieldValue;
    /** A required field with no default that the user has not provided yet. */
    readonly missing: boolean;
}

export interface SetupConnectionPlan {
    readonly id: string;
    readonly label: string;
    readonly provider: string;
    readonly mechanism: Or3PackageConnection['mechanism'];
    readonly required: boolean;
    readonly scopes: readonly string[];
    readonly operationIds: readonly string[];
    readonly externalCost?: string;
    /** Host record for this connection, when one exists. */
    readonly connectionRef?: string;
    readonly satisfied: boolean;
    readonly usable: boolean;
    readonly blockedReason?: string;
}

export interface SetupPlan {
    readonly status: SetupStatus;
    readonly settingsSchemaPath: string;
    readonly fields: readonly SetupFieldPlan[];
    readonly connections: readonly SetupConnectionPlan[];
    readonly testAction?: { readonly operationId: string; readonly deadlineMs: number };
    readonly firstAction: {
        readonly operationId: string;
        readonly label: string;
        readonly usesSampleContext: boolean;
    };
    /** Reasons that keep the plugin from being ready. */
    readonly blockers: readonly string[];
}

export interface SetupConnectionState {
    readonly connectionId: string;
    readonly ref: string;
    readonly scopes: readonly string[];
    /** True only when the current revision passed its test. */
    readonly testPassed: boolean;
    readonly mechanismSatisfied: boolean;
}

export interface BuildSetupPlanInput {
    readonly setup: Or3SetupDescriptorV1;
    readonly policy: Pick<Or3PackagePolicyV1, 'connections'>;
    /** Values the user already provided (settings UI state). */
    readonly values?: Readonly<Record<string, PortableProfileFieldValue>>;
    /** Connections the host has stored for this plugin and workspace. */
    readonly connectionStates?: readonly SetupConnectionState[];
    /** Host-supported mechanisms; a package needs at least one it can use. */
    readonly hostMechanisms?: readonly Or3PackageConnection['mechanism'][];
}

export const DEFAULT_HOST_MECHANISMS: readonly Or3PackageConnection['mechanism'][] = [
    'server',
    'browser',
];

/**
 * Build the setup plan. Required-but-unset fields and unavailable or untested
 * required connections appear as blockers; optional fields are deferred.
 */
export function buildSetupPlan(input: BuildSetupPlanInput): SetupPlan {
    const hostMechanisms = input.hostMechanisms ?? DEFAULT_HOST_MECHANISMS;
    const values = input.values ?? {};
    const connectionStates = input.connectionStates ?? [];
    const blockers: string[] = [];

    const fields: SetupFieldPlan[] = [...input.setup.fields]
        .sort((left, right) => left.order - right.order)
        .map((field) => {
            const provided = values[field.key] !== undefined;
            const hasDefault = field.default !== undefined;
            const missing = field.required && !provided && !hasDefault;
            // Optional settings are always configurable later, never blockers.
            const deferred = !field.required;
            if (missing) {
                blockers.push(`Required setting "${field.label}" has no value`);
            }
            return {
                key: field.key,
                label: field.label,
                kind: field.kind,
                order: field.order,
                required: field.required,
                deferred,
                ...(field.choices === undefined ? {} : { choices: field.choices }),
                ...(field.default === undefined ? {} : { defaultValue: field.default }),
                missing,
            };
        });

    const connections: SetupConnectionPlan[] = input.setup.connections.map(
        (connectionId): SetupConnectionPlan => {
            const declared = input.policy.connections.find(
                (candidate) => candidate.id === connectionId
            );
            if (!declared) {
                blockers.push(
                    `Setup declares connection ${connectionId} that the package policy does not define`
                );
                return {
                    id: connectionId,
                    label: connectionId,
                    provider: 'unknown',
                    mechanism: 'server',
                    required: true,
                    scopes: [],
                    operationIds: [],
                    satisfied: false,
                    usable: false,
                    blockedReason: 'Connection is not declared by the package policy',
                };
            }

            const mechanismSupported = hostMechanisms.includes(declared.mechanism);
            const state = connectionStates.find(
                (candidate) => candidate.connectionId === declared.id
            );
            const scopesSatisfied = Boolean(
                state && declared.scopes.every((scope) => state.scopes.includes(scope))
            );
            const satisfied = Boolean(
                mechanismSupported &&
                    state &&
                    state.testPassed &&
                    scopesSatisfied &&
                    state.mechanismSatisfied
            );

            let blockedReason: string | undefined;
            if (!mechanismSupported) {
                blockedReason = `This host does not support the ${declared.mechanism} mechanism`;
            } else if (!state) {
                blockedReason = 'Not connected yet';
            } else if (!scopesSatisfied) {
                blockedReason = 'Connected credential is missing a required scope';
            } else if (!state.testPassed) {
                blockedReason = 'The connection has not passed its test';
            }

            if (declared.required && !satisfied) {
                blockers.push(
                    `Required connection "${declared.label}" is not ready${blockedReason ? `: ${blockedReason}` : ''}`
                );
            }

            return {
                id: declared.id,
                label: declared.label,
                provider: declared.provider,
                mechanism: declared.mechanism,
                required: declared.required,
                scopes: [...declared.scopes],
                operationIds: [...declared.operations],
                ...(declared.externalCost === undefined
                    ? {}
                    : { externalCost: declared.externalCost }),
                ...(state === undefined ? {} : { connectionRef: state.ref }),
                satisfied,
                // `usable` answers "can this host use this connection at all?";
                // `satisfied` answers "is it connected and tested?".
                usable: mechanismSupported,
                ...(blockedReason === undefined ? {} : { blockedReason }),
            };
        }
    );

    if (!input.setup.firstAction.operationId) {
        blockers.push('The package declares no first action');
    }

    const status: SetupStatus =
        blockers.length > 0 ? 'needs-setup' : 'ready';

    return Object.freeze({
        status,
        settingsSchemaPath: input.setup.settingsSchemaPath,
        fields: Object.freeze(fields),
        connections: Object.freeze(connections),
        ...(input.setup.testAction === undefined
            ? {}
            : { testAction: input.setup.testAction }),
        firstAction: input.setup.firstAction,
        blockers: Object.freeze(blockers),
    });
}

/**
 * Decide what the user sees for a plugin: `Ready` requires every blocker to be
 * cleared; `Needs setup` describes the next action; `blocked` means the host
 * cannot satisfy the package at all (unsupported mechanism or no first action).
 */
export function describeSetupStatus(plan: SetupPlan): {
    readonly status: SetupStatus;
    readonly label: string;
    readonly nextAction?: string;
    readonly blocked?: boolean;
} {
    if (plan.blockers.some((blocker) => blocker.includes('does not support'))) {
        return {
            status: 'blocked',
            label: 'Unsupported on this host',
            blocked: true,
        };
    }
    if (plan.status === 'ready') {
        return { status: 'ready', label: 'Ready' };
    }
    const missingField = plan.fields.find((field) => field.missing);
    if (missingField) {
        return {
            status: 'needs-setup',
            label: 'Needs setup',
            nextAction: `Provide ${missingField.label}`,
        };
    }
    const connection = plan.connections.find(
        (candidate) => candidate.required && !candidate.satisfied
    );
    if (connection) {
        return {
            status: 'needs-setup',
            label: 'Needs setup',
            nextAction: `Connect ${connection.label}`,
        };
    }
    return {
        status: 'needs-setup',
        label: 'Needs setup',
        nextAction: plan.blockers[0],
    };
}

/**
 * The first-action handoff: the host runs the declared action with either the
 * selected context or the package's sample, and never with `.env`, a terminal
 * command or a manually extracted archive.
 */
export interface FirstActionHandoff {
    readonly operationId: string;
    readonly label: string;
    readonly contextKind: 'selected' | 'sample';
    readonly ready: boolean;
    readonly reason?: string;
}

export function buildFirstActionHandoff(input: {
    readonly plan: SetupPlan;
    readonly hasSelectedContext: boolean;
}): FirstActionHandoff {
    const { plan } = input;
    if (plan.status !== 'ready') {
        return {
            operationId: plan.firstAction.operationId,
            label: plan.firstAction.label,
            contextKind: plan.firstAction.usesSampleContext ? 'sample' : 'selected',
            ready: false,
            reason: plan.blockers[0] ?? 'Setup is incomplete',
        };
    }
    if (!plan.firstAction.usesSampleContext && !input.hasSelectedContext) {
        return {
            operationId: plan.firstAction.operationId,
            label: plan.firstAction.label,
            contextKind: 'selected',
            ready: false,
            reason: 'Select a document or message to run this plugin',
        };
    }
    return {
        operationId: plan.firstAction.operationId,
        label: plan.firstAction.label,
        contextKind: plan.firstAction.usesSampleContext ? 'sample' : 'selected',
        ready: true,
    };
}
