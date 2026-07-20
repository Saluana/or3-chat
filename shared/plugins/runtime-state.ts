import type {
    PluginDescriptor,
    PluginLifecycleCoverage,
    Sha256,
} from './runtime-descriptor';

export const PLUGIN_RUNTIME_STATUSES = [
    'discovered',
    'verified',
    'blocked',
    'preparing',
    'activating',
    'active',
    'stopping',
    'failed',
    'quarantined',
] as const;

export type PluginRuntimeStatus = (typeof PLUGIN_RUNTIME_STATUSES)[number];
export type PluginDesiredState = 'active' | 'inactive';
export type PluginRuntimeLoader = 'bundled-v1' | 'module-v2' | 'isolated-client';

export interface SerializedPluginError {
    readonly code: string;
    readonly message: string;
    readonly phase: 'verification' | 'preparation' | 'activation' | 'stop';
    readonly retryable: boolean;
}

export interface PluginRuntimeRecord {
    readonly descriptor: PluginDescriptor;
    readonly desired: PluginDesiredState;
    /** Actual lifecycle state; never inferred from workspace enablement. */
    readonly status: PluginRuntimeStatus;
    readonly generation: number;
    readonly lifecycleCoverage: PluginLifecycleCoverage;
    readonly loader: PluginRuntimeLoader;
    readonly discoveredAt: number;
    readonly updatedAt: number;
    readonly startedAt?: number;
    readonly stoppedAt?: number;
    readonly failureCount: number;
    readonly lastError?: SerializedPluginError;
    readonly nextRetryAt?: number;
    readonly quarantinedDescriptorKey?: Sha256;
    readonly contributionCount: number;
    readonly hookCount: number;
}

const TRANSITIONS = {
    discovered: ['verified', 'blocked'],
    verified: ['preparing', 'blocked'],
    blocked: ['discovered'],
    preparing: ['activating', 'failed', 'quarantined', 'stopping'],
    activating: ['active', 'failed', 'quarantined', 'stopping'],
    active: ['stopping'],
    stopping: ['discovered', 'failed'],
    failed: ['discovered', 'quarantined', 'stopping'],
    quarantined: ['discovered'],
} as const satisfies Record<PluginRuntimeStatus, readonly PluginRuntimeStatus[]>;

export const PLUGIN_RUNTIME_TRANSITIONS: Readonly<
    Record<PluginRuntimeStatus, readonly PluginRuntimeStatus[]>
> = TRANSITIONS;

export interface InvalidRuntimeTransition {
    readonly code: 'invalid-runtime-transition';
    readonly from: PluginRuntimeStatus;
    readonly to: PluginRuntimeStatus;
}

export type RuntimeTransitionResult =
    | { readonly ok: true; readonly status: PluginRuntimeStatus }
    | { readonly ok: false; readonly error: InvalidRuntimeTransition };

export function canTransitionRuntimeStatus(
    from: PluginRuntimeStatus,
    to: PluginRuntimeStatus
): boolean {
    return (PLUGIN_RUNTIME_TRANSITIONS[from] as readonly PluginRuntimeStatus[]).includes(to);
}

/** Validate a lifecycle edge without mutating a runtime record or invoking plugin code. */
export function transitionRuntimeStatus(
    from: PluginRuntimeStatus,
    to: PluginRuntimeStatus
): RuntimeTransitionResult {
    if (canTransitionRuntimeStatus(from, to)) return { ok: true, status: to };
    return {
        ok: false,
        error: { code: 'invalid-runtime-transition', from, to },
    };
}

export interface RuntimeFailurePolicyError {
    readonly code: 'invalid-runtime-failure-policy';
    readonly field: 'previousFailureCount' | 'quarantineThreshold';
}

export type RuntimeFailureClassification =
    | {
          readonly ok: true;
          readonly failureCount: number;
          readonly status: 'failed' | 'quarantined';
      }
    | { readonly ok: false; readonly error: RuntimeFailurePolicyError };

/**
 * Classify an activation attempt without retaining cross-session state.
 * Quarantine ownership remains descriptor-keyed in the manager record.
 */
export function classifyRuntimeFailure(
    previousFailureCount: number,
    quarantineThreshold: number
): RuntimeFailureClassification {
    if (!Number.isSafeInteger(previousFailureCount) || previousFailureCount < 0) {
        return {
            ok: false,
            error: {
                code: 'invalid-runtime-failure-policy',
                field: 'previousFailureCount',
            },
        };
    }
    if (!Number.isSafeInteger(quarantineThreshold) || quarantineThreshold < 1) {
        return {
            ok: false,
            error: {
                code: 'invalid-runtime-failure-policy',
                field: 'quarantineThreshold',
            },
        };
    }
    const failureCount = previousFailureCount + 1;
    return {
        ok: true,
        failureCount,
        status: failureCount >= quarantineThreshold ? 'quarantined' : 'failed',
    };
}
