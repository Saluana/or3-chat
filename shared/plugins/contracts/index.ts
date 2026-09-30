import type { WorkflowToolRegistrationPolicy } from '../../chat/workflow-tool-policy';

/** Version of this shared plugin contract surface. */
export const PLUGIN_CONTRACTS_VERSION = 1 as const;

/** Chat message `data.type` for a workflow execution row. */
export const WORKFLOW_EXECUTION_MESSAGE = 'workflow-execution' as const;

export type ActivityRunKind =
    | 'workflow'
    | 'background-chat'
    | 'document-ai'
    | 'external-agent'
    | 'plugin';

/** Open value for untrusted boundaries. Switch on `ActivityRunKind`, not this. */
export type ActivityRunKindInput = ActivityRunKind | (string & {});

export type { WorkflowToolRegistrationPolicy };

/** Payload stored on a background job while a workflow run is in progress. */
export interface BackgroundExecutionJobContract {
    readonly kind?: 'chat' | 'workflow';
    readonly workflow_state?: {
        readonly type: typeof WORKFLOW_EXECUTION_MESSAGE;
        readonly executionState?: string;
    };
}

export type ConnectRuntime = 'intern' | 'openclaw' | 'hermes';

export interface ConnectEnvironmentContract {
    readonly id?: string;
    readonly runtime?: ConnectRuntime;
}
