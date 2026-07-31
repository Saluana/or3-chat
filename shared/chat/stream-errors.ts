/** Terminal failure raised when a model keeps requesting tools past the admitted limit. */
export class ToolIterationLimitError extends Error {
    readonly code = 'tool_iteration_limit' as const;

    constructor(readonly maxIterations: number) {
        super(`Tool loop exceeded max iterations (${maxIterations})`);
        this.name = 'ToolIterationLimitError';
    }
}
