import { describe, expect, it } from 'vitest';
import type { ExecutionResult } from 'or3-workflow-core';
import { assertBackgroundWorkflowSucceeded } from '../background-execution';

function result(
    success: boolean,
    error?: Error
): ExecutionResult {
    return {
        success,
        output: '',
        finalOutput: '',
        executionOrder: [],
        nodeOutputs: {},
        sessionMessages: [],
        duration: 0,
        error: error as ExecutionResult['error'],
    };
}

describe('background workflow terminal result', () => {
    it('allows successful adapter results', () => {
        expect(() =>
            assertBackgroundWorkflowSucceeded(result(true))
        ).not.toThrow();
    });

    it('throws the adapter error instead of marking the job completed', () => {
        const error = new Error('No endpoints found');
        expect(() =>
            assertBackgroundWorkflowSucceeded(result(false, error))
        ).toThrow(error);
    });
});
