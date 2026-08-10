import type { WorkflowData } from 'or3-workflow-core';
import {
    deriveStartNodeId,
    type ChatHistoryMessage,
    type WorkflowMessageData,
} from '~/utils/chat/workflow-types';

type ResumeSnapshot = Pick<
    WorkflowMessageData,
    | 'resumeState'
    | 'failedNodeId'
    | 'currentNodeId'
    | 'nodeStates'
    | 'lastActiveNodeId'
    | 'nodeOutputs'
    | 'executionOrder'
    | 'sessionMessages'
>;

export interface ReconciledWorkflowResume {
    startNodeId?: string;
    pendingNodes?: string[];
    nodeOutputs: Record<string, string>;
    executionOrder: string[];
    lastActiveNodeId?: string;
    resumeInput?: string;
    sessionMessages?: ChatHistoryMessage[];
    usedGraphFallback: boolean;
}

function unique(ids: string[]): string[] {
    return [...new Set(ids)];
}

/**
 * Reconcile a stored run checkpoint with the workflow as it exists now.
 * Matching completed nodes keep their outputs. Removed node IDs are discarded,
 * and an interrupted run falls forward to the first ready wave in the current
 * graph. If no checkpoint IDs survive, execution restarts after the Start node.
 */
export function reconcileWorkflowResume(
    workflow: WorkflowData,
    snapshot: ResumeSnapshot
): ReconciledWorkflowResume {
    const nodeIds = new Set(workflow.nodes.map((node) => node.id));
    const startIds = new Set(
        workflow.nodes
            .filter((node) => node.type === 'start')
            .map((node) => node.id)
    );
    const storedOutputs =
        snapshot.resumeState?.nodeOutputs || snapshot.nodeOutputs || {};
    const storedOrder =
        snapshot.resumeState?.executionOrder || snapshot.executionOrder || [];

    const completed = new Set<string>(startIds);
    for (const [nodeId, nodeState] of Object.entries(
        snapshot.nodeStates || {}
    )) {
        if (
            nodeIds.has(nodeId) &&
            (nodeState.status === 'completed' || nodeState.status === 'skipped')
        ) {
            completed.add(nodeId);
        }
    }
    for (const nodeId of Object.keys(storedOutputs)) {
        const state = snapshot.nodeStates?.[nodeId];
        if (
            nodeIds.has(nodeId) &&
            (!state ||
                state.status === 'completed' ||
                state.status === 'skipped')
        ) {
            completed.add(nodeId);
        }
    }

    const nodeOutputs: Record<string, string> = {};
    for (const nodeId of completed) {
        if (nodeId in storedOutputs) {
            nodeOutputs[nodeId] = storedOutputs[nodeId] || '';
        } else {
            const output = snapshot.nodeStates?.[nodeId]?.output;
            if (typeof output === 'string') nodeOutputs[nodeId] = output;
        }
    }

    const storedStartNodeId = deriveStartNodeId({
        resumeState: snapshot.resumeState,
        failedNodeId: snapshot.failedNodeId,
        currentNodeId: snapshot.currentNodeId,
        nodeStates: snapshot.nodeStates,
        lastActiveNodeId: snapshot.lastActiveNodeId,
    });
    const storedPending = unique(
        (snapshot.resumeState?.pendingNodes || []).filter(
            (nodeId) => nodeIds.has(nodeId) && !completed.has(nodeId)
        )
    );
    const storedStartIsRunnable = Boolean(
        storedStartNodeId &&
        nodeIds.has(storedStartNodeId) &&
        !completed.has(storedStartNodeId)
    );

    let pendingNodes: string[] = [];
    let usedGraphFallback = false;

    if (storedPending.length > 0) {
        pendingNodes = storedPending;
    } else if (storedStartIsRunnable && storedStartNodeId) {
        pendingNodes = [storedStartNodeId];
    } else {
        usedGraphFallback = true;
        const incoming = new Map<string, string[]>();
        for (const edge of workflow.edges) {
            if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target))
                continue;
            const sources = incoming.get(edge.target) || [];
            sources.push(edge.source);
            incoming.set(edge.target, sources);
        }

        pendingNodes = workflow.nodes
            .filter((node) => {
                if (startIds.has(node.id) || completed.has(node.id))
                    return false;
                const parents = incoming.get(node.id) || [];
                return (
                    parents.length > 0 &&
                    parents.every((parentId) => completed.has(parentId))
                );
            })
            .map((node) => node.id);

        if (pendingNodes.length === 0) {
            const firstUnfinished = workflow.nodes.find(
                (node) => !startIds.has(node.id) && !completed.has(node.id)
            );
            if (firstUnfinished) pendingNodes = [firstUnfinished.id];
        }

        // The run may have reached every node but failed before its terminal
        // state was persisted. Re-running the final executable node lets the
        // engine rebuild the result instead of leaving the card stranded.
        if (pendingNodes.length === 0) {
            const lastExecutable = [...workflow.nodes]
                .reverse()
                .find((node) => !startIds.has(node.id));
            if (lastExecutable) pendingNodes = [lastExecutable.id];
        }
    }

    pendingNodes = unique(pendingNodes);
    for (const nodeId of pendingNodes) {
        delete nodeOutputs[nodeId];
        completed.delete(nodeId);
    }

    const executionOrder = unique(storedOrder).filter(
        (nodeId) =>
            nodeIds.has(nodeId) &&
            completed.has(nodeId) &&
            !pendingNodes.includes(nodeId)
    );
    const lastActiveNodeId = [...executionOrder]
        .reverse()
        .find((nodeId) => nodeId in nodeOutputs);
    const hasReusableProgress = executionOrder.length > 0;

    return {
        startNodeId: pendingNodes[0],
        pendingNodes: pendingNodes.length ? pendingNodes : undefined,
        nodeOutputs,
        executionOrder,
        lastActiveNodeId,
        resumeInput: lastActiveNodeId
            ? nodeOutputs[lastActiveNodeId]
            : undefined,
        sessionMessages: hasReusableProgress
            ? snapshot.sessionMessages || snapshot.resumeState?.sessionMessages
            : undefined,
        usedGraphFallback,
    };
}
