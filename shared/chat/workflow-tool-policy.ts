/**
 * Optional workflow-runtime policy attached to a chat tool registration.
 *
 * These fields are host metadata and are never sent to the model provider.
 * Defaults preserve the behavior of tools registered before typed workflow
 * tools existed: no declared side effect, policy-based approval, and safe
 * parallel execution.
 */
export interface WorkflowToolRegistrationPolicy {
    sideEffect?: 'none' | 'reversible' | 'destructive';
    approval?: 'never' | 'policy' | 'always';
    parallelSafe?: boolean;
    permissions?: string[];
    idempotencyKey?: (input: unknown) => string;
}

export const DEFAULT_WORKFLOW_TOOL_POLICY = {
    sideEffect: 'none',
    approval: 'policy',
    parallelSafe: true,
} as const;
