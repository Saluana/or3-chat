# useWorkflowStreamAccumulator

Reactive accumulator for workflow execution streaming. It receives per-node execution events and exposes a single read-only state object that UI components can render live.

## Purpose

`createWorkflowStreamAccumulator()` returns an API that turns execution events into reactive state:

-   `state` — read-only `WorkflowStreamingState` with workflow info, per-node states, branch states, token usage, HITL requests, final output, and an error field.
-   Updates are batched via `requestAnimationFrame` to keep rendering smooth.

## API

| Method | Description |
| ------ | ----------- |
| `setWorkflowInfo(id, name)` | Set workflow identity. |
| `setAttachments(attachments?)` | Attach files available to the run. |
| `setImageCaption(caption?)` | Store an auto-generated image caption. |
| `nodeStart(nodeId, label, type, modelId?)` | Mark a node as running. |
| `nodeToken(nodeId, token)` | Append a streamed token to a node. |
| `nodeReasoning(nodeId, token)` | Append a reasoning token to a node. |
| `nodeFinish(nodeId, output)` | Mark a node complete with its output. |
| `nodeError(nodeId, error)` | Mark a node failed. |
| `routeSelected(nodeId, route)` | Record a routed branch choice. |
| `tokenUsage(nodeId, usage)` | Record token counts for a node. |
| `branchStart(nodeId, branchId, label)` | Start a parallel branch. |
| `branchToken(nodeId, branchId, label, token)` | Append a token to a branch. |
| `branchReasoning(nodeId, branchId, label, token)` | Append a reasoning token to a branch. |
| `branchComplete(nodeId, branchId, label, output)` | Finish a branch. |
| `toolCallEvent(event)` | Record a tool call event. |
| `hitlRequest(request)` | Register a human-in-the-loop request. |
| `hitlResolve(requestId, response?)` | Resolve a HITL request with an optional action and data. |
| `workflowToken(token, meta?)` | Append a workflow-level token (leaf aggregation). |
| `finalize(opts?)` | Seal the run. Accepts an error, a stopped flag, or a full result object (final output, usage, node outputs, session messages). |
| `reset()` | Clear all state so a new run can start. |
| `toMessageData(workflowId, workflowName, prompt)` | Build a persisted message payload from the current state. |

The accumulator also provides `finalize()` and `reset()` so a workflow run can end cleanly and a new run can start. `toMessageData()` packages the state for persistence.

## Usage

```ts
import { createWorkflowStreamAccumulator } from '~/composables/chat/useWorkflowStreamAccumulator';

const workflow = createWorkflowStreamAccumulator();

// Feed events from the execution engine:
workflow.setWorkflowInfo('wf-1', 'Research Brief');
workflow.nodeStart('node-a', 'Outline', 'llm');
workflow.nodeToken('node-a', 'First');
workflow.nodeFinish('node-a', 'Done');

// Render:
watch(
    () => workflow.state.version,
    () => {
        renderPanel.value = workflow.state.nodeStates;
    }
);
```

## Notes

-   `state.executionState` is `'running'` initially and moves to a terminal value on finalize.
-   `state.version` increments on every update, which is ideal for lightweight watchers.

## Related

-   `useStreamAccumulator` — the simpler text-only accumulator for chat streams.
-   Workflow execution engine (`~/core/workflows`) — the event source.
