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
 * - A stored connection only satisfies a declared requirement through an
 *   explicit slot binding, and only when the registered host provider supports
 *   the declared mechanism, scopes and operations.
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
import { isSetupValuePresent } from './values';

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
    /** Host record bound to this declared slot, when one exists. */
    readonly connectionRef?: string;
    readonly satisfied: boolean;
    /** True when the host can support this requirement at all. */
    readonly usable: boolean;
    /** True when the host provably cannot satisfy it (wrong provider/mechanism). */
    readonly unsupported: boolean;
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
        /** Present only when the package ships a resolvable sample file. */
        readonly samplePath?: string;
    };
    /** Reasons that keep the plugin from being ready. */
    readonly blockers: readonly string[];
}

/**
 * A host connection the plugin is bound to. `slotId` is the declared package
 * connection id: the stored record's own id is host-generated, so without this
 * binding the plan cannot tell which requirement a credential satisfies.
 */
export interface SetupConnectionState {
    readonly slotId: string;
    readonly connectionId: string;
    readonly ref: string;
    readonly providerId: string;
    readonly scopes: readonly string[];
    /** True only when the current revision passed its test. */
    readonly testPassed: boolean;
}

/**
 * Capabilities of one registered host provider. The host capability list is the
 * authority for what a declared requirement can use; there is no default that
 * assumes browser and server support both exist.
 */
export interface HostConnectionCapability {
    readonly provider: string;
    readonly mechanism: Or3PackageConnection['mechanism'];
    readonly scopes: readonly string[];
    readonly operations: readonly string[];
}

export interface BuildSetupPlanInput {
    readonly setup: Or3SetupDescriptorV1;
    readonly policy: Pick<Or3PackagePolicyV1, 'connections'>;
    /** Values the user already provided and that passed schema validation. */
    readonly values?: Readonly<Record<string, PortableProfileFieldValue>>;
    /** Connections the host has stored for this plugin and workspace. */
    readonly connectionStates?: readonly SetupConnectionState[];
    /**
     * Registered host providers. Omitted means "no capabilities known", which
     * fails closed rather than assuming a mechanism is supported.
     */
    readonly hostConnections?: readonly HostConnectionCapability[];
}

/**
 * Build the setup plan. Required-but-unset fields and unavailable or untested
 * required connections appear as blockers; optional fields are deferred.
 */
export function buildSetupPlan(input: BuildSetupPlanInput): SetupPlan {
    const hostConnections = input.hostConnections ?? [];
    const values = input.values ?? {};
    const connectionStates = input.connectionStates ?? [];
    const blockers: string[] = [];

    const fields: SetupFieldPlan[] = [...input.setup.fields]
        .sort((left, right) => left.order - right.order)
        .map((field) => {
            // An empty string or a blank select is not "supplied": presence is
            // decided by the same helper the save endpoint validates with.
            const provided = isSetupValuePresent(field, values[field.key]);
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
                    // A malformed package is reported as a blocker: it is not a
                    // host capability gap, but the user cannot resolve it either.
                    unsupported: false,
                    blockedReason: 'Connection is not declared by the package policy',
                };
            }

            const host = hostConnections.find(
                (candidate) => candidate.provider === declared.provider
            );
            const mechanismSupported = host?.mechanism === declared.mechanism;
            const missingOperations =
                host === undefined
                    ? [...declared.operations]
                    : declared.operations.filter(
                          (operation) => !host.operations.includes(operation)
                      );
            const missingProviderScopes =
                host === undefined
                    ? [...declared.scopes]
                    : declared.scopes.filter((scope) => !host.scopes.includes(scope));
            const capabilitySupported =
                host !== undefined &&
                mechanismSupported &&
                missingOperations.length === 0 &&
                missingProviderScopes.length === 0;

            const state = connectionStates.find(
                (candidate) => candidate.slotId === declared.id
            );
            const boundProviderMatches = state?.providerId === declared.provider;
            const scopesSatisfied = Boolean(
                state &&
                    boundProviderMatches &&
                    declared.scopes.every((scope) => state.scopes.includes(scope))
            );
            const satisfied = Boolean(
                capabilitySupported && scopesSatisfied && state?.testPassed
            );

            let blockedReason: string | undefined;
            if (host === undefined) {
                blockedReason = `This host has no connection provider named "${declared.provider}"`;
            } else if (!mechanismSupported) {
                blockedReason = `This host does not support the ${declared.mechanism} mechanism for ${declared.provider}`;
            } else if (missingOperations.length > 0) {
                blockedReason = `The ${declared.provider} provider does not declare ${missingOperations.join(', ')}`;
            } else if (missingProviderScopes.length > 0) {
                blockedReason = `The ${declared.provider} provider does not declare the ${missingProviderScopes.join(', ')} scope`;
            } else if (!state) {
                blockedReason = 'Not connected yet';
            } else if (!boundProviderMatches) {
                blockedReason = 'The connected credential belongs to another provider';
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
                usable: capabilitySupported,
                unsupported: !capabilitySupported,
                ...(blockedReason === undefined ? {} : { blockedReason }),
            };
        }
    );

    if (!input.setup.firstAction.operationId) {
        blockers.push('The package declares no first action');
    }

    const unsupported = connections.some((connection) => connection.unsupported);
    const status: SetupStatus = unsupported
        ? 'blocked'
        : blockers.length > 0
          ? 'needs-setup'
          : 'ready';

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
    if (plan.status === 'blocked') {
        return {
            status: 'blocked',
            label: 'Unsupported on this host',
            blocked: true,
            nextAction: plan.blockers[0],
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
 * The first-action handoff: the host runs the declared action with the user's
 * selected context when there is one, and only falls back to the package's
 * sample when the package ships one and no selection exists. `.env`, terminal
 * commands and manually extracted archives are never a context source.
 */
export interface FirstActionHandoff {
    readonly operationId: string;
    readonly label: string;
    readonly contextKind: 'selected' | 'sample';
    readonly ready: boolean;
    readonly reason?: string;
    /** Machine-readable cause, so callers never match on the message text. */
    readonly reasonCode?: 'setup-incomplete' | 'selection-required';
}

export function buildFirstActionHandoff(input: {
    readonly plan: SetupPlan;
    readonly hasSelectedContext: boolean;
}): FirstActionHandoff {
    const { plan } = input;
    const samplePath = plan.firstAction.samplePath;
    const hasSample = typeof samplePath === 'string' && samplePath.length > 0;
    // Selected context is always preferred; the sample is a fallback, not an
    // override, so opening a plugin on a document never silently runs a fixture.
    const contextKind: FirstActionHandoff['contextKind'] =
        input.hasSelectedContext || !hasSample ? 'selected' : 'sample';
    if (plan.status !== 'ready') {
        return {
            operationId: plan.firstAction.operationId,
            label: plan.firstAction.label,
            contextKind,
            ready: false,
            reason: plan.blockers[0] ?? 'Setup is incomplete',
            reasonCode: 'setup-incomplete',
        };
    }
    if (contextKind === 'selected' && !input.hasSelectedContext) {
        return {
            operationId: plan.firstAction.operationId,
            label: plan.firstAction.label,
            contextKind: 'selected',
            ready: false,
            reason: 'Select a document or message to run this plugin',
            reasonCode: 'selection-required',
        };
    }
    return {
        operationId: plan.firstAction.operationId,
        label: plan.firstAction.label,
        contextKind,
        ready: true,
    };
}
