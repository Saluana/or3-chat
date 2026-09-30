export interface PluginStateCompatibilityPolicy {
    readonly version: number;
    readonly reads: {
        readonly minimum: number;
        readonly maximum: number;
    };
    readonly rollback: 'safe' | 'migration-required' | 'unsupported';
}

export type PluginStatePreflightOperation = 'install' | 'upgrade' | 'rollback';
export type PluginStatePreflightCode =
    | 'state-initialization'
    | 'state-compatible'
    | 'state-version-unreadable'
    | 'rollback-migration-required'
    | 'rollback-unsupported';

export interface PluginStatePreflightResult {
    readonly status: 'eligible' | 'migration-required' | 'blocked';
    readonly code: PluginStatePreflightCode;
    readonly operation: PluginStatePreflightOperation;
    readonly storedStateVersion: number | null;
    readonly targetStateVersion: number;
    readonly readableStateVersions: {
        readonly minimum: number;
        readonly maximum: number;
    };
    readonly mutatesState: false;
    readonly summary: string;
}

export interface PluginStatePreflightInput {
    readonly operation: PluginStatePreflightOperation;
    readonly storedStateVersion: number | null;
    readonly target: PluginStateCompatibilityPolicy;
    readonly current?: PluginStateCompatibilityPolicy;
}

function result(
    input: PluginStatePreflightInput,
    status: PluginStatePreflightResult['status'],
    code: PluginStatePreflightCode,
    summary: string
): PluginStatePreflightResult {
    return Object.freeze({
        status,
        code,
        operation: input.operation,
        storedStateVersion: input.storedStateVersion,
        targetStateVersion: input.target.version,
        readableStateVersions: Object.freeze({ ...input.target.reads }),
        mutatesState: false,
        summary,
    });
}

/** Pure state/package eligibility check. It never reads or mutates a storage adapter. */
export function preflightPluginStateCompatibility(
    input: PluginStatePreflightInput
): PluginStatePreflightResult {
    if (input.storedStateVersion === null) {
        return result(
            input,
            'eligible',
            'state-initialization',
            `The package can initialize state schema ${input.target.version}`
        );
    }
    if (input.operation === 'rollback') {
        if (!input.current) {
            return result(
                input,
                'blocked',
                'rollback-unsupported',
                'Rollback state policy is unavailable for the active package'
            );
        }
        if (input.current.rollback === 'unsupported') {
            return result(
                input,
                'blocked',
                'rollback-unsupported',
                'The active package explicitly disallows state rollback'
            );
        }
        if (input.current.rollback === 'migration-required') {
            return result(
                input,
                'migration-required',
                'rollback-migration-required',
                'Rollback requires an approved down-migration before package selection changes'
            );
        }
    }
    const readable =
        input.storedStateVersion >= input.target.reads.minimum &&
        input.storedStateVersion <= input.target.reads.maximum;
    if (!readable) {
        return result(
            input,
            'blocked',
            'state-version-unreadable',
            `State schema ${input.storedStateVersion} is outside the target readable range ` +
                `${input.target.reads.minimum}-${input.target.reads.maximum}`
        );
    }
    return result(
        input,
        'eligible',
        'state-compatible',
        `The target package can read stored state schema ${input.storedStateVersion}`
    );
}

export interface PluginUpdateExplanationInput {
    readonly pluginId: string;
    readonly currentPackageVersion?: string;
    readonly candidatePackageVersion: string;
    readonly state: PluginStatePreflightResult;
    readonly verificationBlockCodes?: readonly string[];
    readonly grantReviewStatus?: 'current' | 'unreviewed' | 'stale';
}

export interface PluginUpdateExplanation {
    readonly pluginId: string;
    readonly operation: PluginStatePreflightOperation;
    readonly canProceed: boolean;
    readonly requiresMigration: boolean;
    readonly headline: string;
    readonly reasons: readonly {
        readonly code: string;
        readonly severity: 'info' | 'warning' | 'error';
        readonly message: string;
    }[];
    readonly state: PluginStatePreflightResult;
}

/** Produces the admin update/rollback explanation without performing the operation. */
export function buildPluginUpdateExplanation(
    input: PluginUpdateExplanationInput
): PluginUpdateExplanation {
    const reasons: Array<PluginUpdateExplanation['reasons'][number]> = [
        Object.freeze({
            code: input.state.code,
            severity:
                input.state.status === 'eligible'
                    ? 'info'
                    : input.state.status === 'migration-required'
                      ? 'warning'
                      : 'error',
            message: input.state.summary,
        }),
    ];
    for (const code of input.verificationBlockCodes ?? []) {
        reasons.push(
            Object.freeze({
                code,
                severity: 'error',
                message: `Package verification blocked: ${code}`,
            })
        );
    }
    if (input.grantReviewStatus && input.grantReviewStatus !== 'current') {
        reasons.push(
            Object.freeze({
                code: `grant-review-${input.grantReviewStatus}`,
                severity: 'error',
                message: 'Requested plugin grants require administrator review',
            })
        );
    }
    const canProceed =
        input.state.status === 'eligible' &&
        reasons.every((entry) => entry.severity !== 'error');
    const operationLabel =
        input.state.operation === 'rollback'
            ? `Rollback to ${input.candidatePackageVersion}`
            : input.currentPackageVersion
              ? `Update to ${input.candidatePackageVersion}`
              : `Install ${input.candidatePackageVersion}`;
    return Object.freeze({
        pluginId: input.pluginId,
        operation: input.state.operation,
        canProceed,
        requiresMigration: input.state.status === 'migration-required',
        headline: canProceed ? `${operationLabel} is eligible` : `${operationLabel} is blocked`,
        reasons: Object.freeze(reasons),
        state: input.state,
    });
}
