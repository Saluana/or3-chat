import { describe, expect, it } from 'vitest';
import { resolvePluginRoutePermission } from '../../shared/plugins/route-permissions';
import {
    PLUGIN_CONTRACTS_VERSION,
    WORKFLOW_EXECUTION_MESSAGE,
    type BackgroundExecutionJobContract,
    type ConnectEnvironmentContract,
} from '../../shared/plugins/contracts';
import type { ActivityRunKind } from '../../app/core/activity/contract';
import type { WorkflowToolRegistrationPolicy } from '../../shared/chat/workflow-tool-policy';

describe('trusted plugin host contracts', () => {
    it('keeps plugin route permissions strengthen-only and exposes workflow job state', () => {
        expect(PLUGIN_CONTRACTS_VERSION).toBe(1);
        expect(resolvePluginRoutePermission('POST', 'workspace.read')).toBe('workspace.write');
        expect(resolvePluginRoutePermission('GET', 'workspace.write')).toBe('workspace.write');
        expect(resolvePluginRoutePermission('GET')).toBe('workspace.read');

        const job: BackgroundExecutionJobContract = {
            kind: 'workflow',
            workflow_state: {
                type: WORKFLOW_EXECUTION_MESSAGE,
                executionState: 'running',
            },
        };
        const kind: ActivityRunKind = 'workflow';
        const policy: WorkflowToolRegistrationPolicy = { sideEffect: 'none', approval: 'policy' };
        const environment: ConnectEnvironmentContract = { runtime: 'openclaw' };

        expect(job.workflow_state?.type).toBe('workflow-execution');
        expect(kind).toBe('workflow');
        expect(policy.approval).toBe('policy');
        expect(environment.runtime).toBe('openclaw');
    });
});
