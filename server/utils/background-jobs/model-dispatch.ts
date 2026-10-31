import { OpenRouterStreamError } from '~~/shared/openrouter/errors';
import type { BackgroundJobExecution } from './types';

/** Preserve explicit provider refusals; all other errors after dispatch are uncertain. */
export function classifyDelegationDispatchFailure(error: unknown, execution?: BackgroundJobExecution): unknown {
    if (execution?.delegationRecoveryPolicy !== 'v1' || execution.delegationDispatch === undefined) return error;
    if (error instanceof OpenRouterStreamError && 'confirmedModelRejection' in error && error.confirmedModelRejection === true &&
        [400, 401, 402, 403, 404, 422, 429].includes(error.status)) return error;
    return Object.assign(new Error('Model request outcome is unknown.', { cause: error }), {
        code: 'ERR_MODEL_OUTCOME_UNKNOWN', retryable: false,
    });
}
