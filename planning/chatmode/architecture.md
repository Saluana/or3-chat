# Workflow Message Integration - Architecture Document

## Executive Summary

This document captures the architectural analysis of integrating or3-workflows execution into or3-chat's reactive message system. It identifies **critical gaps** between the current spec and actual codebase behavior, and provides **validated solutions**.

---

## 🔴 Critical Findings

### Finding 1: onNodeStart Signature Mismatch ✅ RESOLVED

**Spec assumed:**

```typescript
onNodeStart: (nodeId: string, label: string, type: string) => void
```

**Previous API (from or3-workflows):**

```typescript
onNodeStart: (nodeId: string) => void  // Only nodeId!
```

**NEW API (or3-workflows update):**

```typescript
onNodeStart: (nodeId: string, nodeInfo?: NodeInfo) => void

interface NodeInfo {
    label: string;
    type: string;
}
```

**Resolution:** The `onNodeStart` callback now receives an optional `NodeInfo` object containing `{label, type}` automatically extracted from the workflow. Existing callbacks that only accept `nodeId` continue to work (backward compatible).

**Updated usage:**

```typescript
onNodeStart: (nodeId, nodeInfo) => {
    accumulator.nodeStart(
        nodeId,
        nodeInfo?.label || nodeId,
        nodeInfo?.type || 'unknown'
    );
};
```

---

### Finding 2: Reactivity Bypass (Critical Bug)

**Current behavior:** The workflow slash command plugin writes to Dexie directly via `db.messages.put()`, but this **does NOT update:**

-   `tailAssistant` ref (watched by ChatContainer)
-   `streamAccumulator` state (used for streaming UI)

**Root cause:** The plugin intercepts at `ai.chat.messages:filter:before_send` and returns `{ messages: [] }`, which causes `useAi.send()` to skip its streaming loop entirely. The workflow then runs async with no connection to Vue reactivity.

**Why users see no updates:** The UI only re-renders when `tailAssistant` or `streamState` change. Database changes alone don't trigger re-renders.

**Solution:** The spec's `WorkflowStreamAccumulator` must connect to the reactive layer. Two options:

1. **Option A (Recommended): Emit state via hook, let ChatContainer subscribe**

    ```typescript
    // In slash command plugin:
    hooks.doAction('workflow.execution:action:state_update', {
        messageId: assistantDbMsg.id,
        state: accumulator.state, // Reactive ref
    });

    // In ChatContainer or useAi:
    hooks.on(
        'workflow.execution:action:state_update',
        ({ messageId, state }) => {
            workflowStates.set(messageId, state);
            // Force re-render of that message
        }
    );
    ```

2. **Option B: Expose mutation API on useAi**
   Add `setWorkflowState(messageId, state)` to the `useAi` composable API.

---

### Finding 3: Branch Callback Signature Has 4 Parameters

**Spec assumes (3 params):**

```typescript
branchStart(nodeId, branchId, label);
branchToken(nodeId, branchId, token);
```

**Actual API (4 params):**

```typescript
onBranchStart?: (nodeId: string, branchId: string, branchLabel: string) => void
onBranchToken?: (nodeId: string, branchId: string, branchLabel: string, token: string) => void
```

**Impact:** Need to pass `branchLabel` separately to the accumulator, not extract from branchId.

**Solution:** Update accumulator API:

```typescript
branchStart(nodeId: string, branchId: string, label: string): void
branchToken(nodeId: string, branchId: string, label: string, token: string): void
```

---

### Finding 4: Missing Callbacks in Current Plugin ✅ RESOLVED

The current `executeWorkflow.ts` only wires 4 callbacks:

```typescript
const callbacks: ExecutionCallbacks = {
    onNodeStart: onNodeStart || (() => {}),
    onNodeFinish: onNodeFinish || (() => {}),
    onNodeError: (_nodeId, error) => onError?.(error),
    onToken: (_nodeId, token) => onToken(token),
};
```

**Previously missing callbacks:**

-   `onReasoning` - for thinking/reasoning tokens
-   `onBranchStart` - parallel branch starts
-   `onBranchToken` - parallel branch streaming
-   `onBranchComplete` - parallel branch completion
-   `onBranchReasoning` - parallel branch thinking
-   `onRouteSelected` - router decisions
-   `onTokenUsage` - token counting

**NEW API (or3-workflows update):**

or3-workflows now exports a `createAccumulatorCallbacks` helper that automatically wires all callbacks:

```typescript
import { createAccumulatorCallbacks } from '@or3/workflow-core';

const callbacks = createAccumulatorCallbacks(workflow, {
    onNodeStart: accumulator.nodeStart,
    onNodeToken: accumulator.nodeToken,
    onNodeReasoning: accumulator.nodeReasoning,
    onNodeFinish: accumulator.nodeFinish,
    onNodeError: accumulator.nodeError,
    onBranchStart: accumulator.branchStart,
    onBranchToken: accumulator.branchToken,
    onBranchComplete: accumulator.branchComplete,
});
```

**Resolution:** Use `createAccumulatorCallbacks` to wire all callbacks with a single call. This eliminates ~30 lines of manual node lookups and callback mappings.

**Note on `__merge__` branch:** Parallel nodes emit a special branch with `branchId === '__merge__'` for the merge step. The UI should display this as "Merging results..." or similar.

---

### Finding 5: Token Callback Loses NodeId

**Current code:**

```typescript
onToken: (_nodeId, token) => onToken(token),  // nodeId discarded!
```

The current implementation discards the nodeId, making it impossible to track which node is producing tokens.

**Solution:** Pass nodeId through to the accumulator:

```typescript
onToken: (nodeId, token) => accumulator.nodeToken(nodeId, token),
```

---

### Finding 6: Stop Method is on Adapter, Not Return Value

**Spec assumes:**

```typescript
const controller = execMod.executeWorkflow({ ... });
controller.stop();  // ✓ This works (via wrapper)
```

**Actual or3-workflows API:**

```typescript
const adapter = new OpenRouterExecutionAdapter(client, options);
const resultPromise = adapter.execute(workflow, input, callbacks);
adapter.stop(); // Stop is on the adapter, not the promise
```

**Current implementation:** The `executeWorkflow.ts` wrapper correctly abstracts this:

```typescript
return {
    promise,
    stop: () => {
        stopped = true;
        if (adapter && typeof adapter.stop === 'function') {
            adapter.stop();
        }
    },
    isRunning: () => (adapter ? adapter.isRunning() : false),
};
```

✅ **No action needed** - the wrapper handles this correctly.

---

### Finding 7: Timestamp Unit Mismatch

**Current plugin code:**

```typescript
updated_at: Date.now(); // Returns milliseconds
```

**Schema expects:**

```typescript
updated_at: z.number().int(); // Convention: seconds (nowSec())
```

Looking at `app/db/utils.ts`:

```typescript
export function nowSec(): number {
    return Math.floor(Date.now() / 1000);
}
```

**Impact:** Messages will have timestamps 1000x larger than expected.

**Solution:** Import and use `nowSec()` instead of `Date.now()`.

---

### Finding 8: Merge Branch ID

Parallel nodes emit a special `__merge__` branch for the merge step:

```typescript
const mergeBranchId = '__merge__';
const mergeBranchLabel = 'Merge';
```

**Impact:** The UI should handle this specially (show as "Merging..." or similar).

**Solution:** Check for `branchId === '__merge__'` in `WorkflowExecutionStatus.vue`.

---

## ✅ Validated Design Elements

### Data Field Discriminator ✅

Using `data.type: 'workflow-execution'` is safe because:

-   The `data` field is `z.unknown()` - accepts any shape
-   No existing code assumes a specific data structure
-   Detection via `data?.type === 'workflow-execution'` is backward compatible

### RAF Batching ✅

The existing `useStreamAccumulator.ts` pattern is proven and should be replicated:

-   Batch pending tokens in arrays
-   Schedule single RAF per frame
-   Increment version counter for watchers
-   100KB warning threshold for memory

### UiChatMessage Extension ✅

All new fields are optional (`?`), so existing code continues to work:

```typescript
isWorkflow?: boolean;      // undefined for regular messages
workflowState?: {...};     // undefined for regular messages
```

### Execution Order Tracking ✅

Using an array that tracks nodes in execution order:

```typescript
executionOrder: string[]  // Push on nodeStart, iterate for display
```

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           User Types "/workflow prompt"                   │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │
                                    ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                     ai.chat.messages:filter:before_send                    │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │ parseSlashCommand() → detectWorkflow → return { messages: [] }      │   │
│  └────────────────────────────────────────────────────────────────────┘   │
└───────────────────────────────────┬───────────────────────────────────────┘
                                    │ Async execution starts
                                    ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                      WorkflowStreamAccumulator                             │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │ state = reactive({                                                   │  │
│  │   executionState, nodeStates, branches, executionOrder,              │  │
│  │   currentNodeId, finalOutput, version                                │  │
│  │ })                                                                   │  │
│  ├─────────────────────────────────────────────────────────────────────┤  │
│  │ Methods:                                                             │  │
│  │   nodeStart(nodeId, label, type)  → create nodeState, push order    │  │
│  │   nodeToken(nodeId, token)        → batch to pendingNodeTokens      │  │
│  │   nodeFinish(nodeId, output)      → flush, set completed            │  │
│  │   branchStart/Token/Complete      → track parallel branches          │  │
│  │   finalize({ error?, stopped? })  → set final state                 │  │
│  │   toMessageData()                 → serialize for DB                 │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────┬───────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
                    ▼                               ▼
┌─────────────────────────────────┐   ┌─────────────────────────────────────┐
│   RAF Flush → state.version++   │   │  Throttled (500ms) → DB Persist     │
│   Vue reactivity triggers       │   │  db.messages.put({ data: ... })      │
└─────────────────────────────────┘   └─────────────────────────────────────┘
                    │
                    ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                       UI Reactivity Bridge                                 │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │ workflow.execution:action:state_update hook                          │  │
│  │   → ChatContainer subscribes                                         │  │
│  │   → Updates workflowMessages Map<messageId, AccumulatorState>        │  │
│  │   → Triggers computed re-evaluation                                  │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────┬───────────────────────────────────────┘
                                    │
                                    ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                         ChatMessage.vue                                    │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │ <WorkflowExecutionStatus                                             │  │
│  │   v-if="isWorkflow && workflowState"                                 │  │
│  │   :workflow-name="workflowState.workflowName"                        │  │
│  │   :execution-state="workflowState.executionState"                    │  │
│  │   :node-states="workflowState.nodeStates"                            │  │
│  │   :execution-order="workflowState.executionOrder"                    │  │
│  │   :current-node-id="workflowState.currentNodeId"                     │  │
│  │   :branches="workflowState.branches"                                 │  │
│  │ />                                                                   │  │
│  │ <StreamMarkdown :content="message.text" />  ← finalOutput            │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow: Streaming Tokens

```
or3-workflows                 WorkflowStreamAccumulator           Vue Reactivity
─────────────                 ──────────────────────────           ──────────────
onToken(nodeId, token)
       │
       └──► nodeToken(nodeId, token)
                    │
                    ├──► pendingNodeTokens.get(nodeId).push(token)
                    │
                    └──► scheduleFlush()
                              │
                              └──► requestAnimationFrame(flush)
                                          │
                                          ├──► Concatenate pending tokens
                                          │    state.nodeStates[nodeId].streamingText += joined
                                          │
                                          └──► state.version++
                                                     │
                                                     └──► watchers trigger
                                                          │
                                                          └──► UI re-renders
```

---

## Data Flow: Database Persistence

```
Execution Callback            Accumulator                    Persistence
──────────────────            ───────────                    ───────────
onNodeFinish(nodeId, output)
       │
       └──► nodeFinish(nodeId, output)
                    │
                    ├──► Force flush pending tokens
                    ├──► nodeStates[nodeId].status = 'completed'
                    ├──► nodeStates[nodeId].output = output
                    │
                    └──► persistWorkflowState() [throttled 500ms]
                              │
                              └──► db.messages.put({
                                       id: messageId,
                                       data: accumulator.toMessageData(),
                                       updated_at: nowSec()
                                   })
```

---

## ExecutionCallbacks Wiring (Simplified with createAccumulatorCallbacks)

With the new `createAccumulatorCallbacks` helper from or3-workflows, callback wiring is dramatically simplified:

### Before (~40 lines):

```typescript
// Old approach - manual node lookups required
const accumulator = createWorkflowStreamAccumulator();

const callbacks: ExecutionCallbacks = {
    onNodeStart: (nodeId) => {
        const node = workflow.nodes.find((n) => n.id === nodeId);
        const nodeData = node?.data as Record<string, unknown> | undefined;
        const label =
            typeof nodeData?.label === 'string' ? nodeData.label : nodeId;
        const type = node?.type || 'unknown';
        accumulator.nodeStart(nodeId, label, type);
    },
    onNodeFinish: (nodeId, output) => accumulator.nodeFinish(nodeId, output),
    onNodeError: (nodeId, error) => accumulator.nodeError(nodeId, error),
    onToken: (nodeId, token) => accumulator.nodeToken(nodeId, token),
    onReasoning: (nodeId, token) => accumulator.nodeReasoning(nodeId, token),
    onBranchStart: (nodeId, branchId, branchLabel) =>
        accumulator.branchStart(nodeId, branchId, branchLabel),
    onBranchToken: (nodeId, branchId, branchLabel, token) =>
        accumulator.branchToken(nodeId, branchId, branchLabel, token),
    onBranchComplete: (nodeId, branchId, branchLabel, output) =>
        accumulator.branchComplete(nodeId, branchId, output),
};
```

### After (~10 lines):

```typescript
import { createAccumulatorCallbacks } from '@or3/workflow-core';

const accumulator = createWorkflowStreamAccumulator();

const callbacks = createAccumulatorCallbacks(workflow, {
    onNodeStart: accumulator.nodeStart,
    onNodeToken: accumulator.nodeToken,
    onNodeReasoning: accumulator.nodeReasoning,
    onNodeFinish: accumulator.nodeFinish,
    onNodeError: accumulator.nodeError,
    onBranchStart: accumulator.branchStart,
    onBranchToken: accumulator.branchToken,
    onBranchComplete: accumulator.branchComplete,
});
```

### How it works:

1. `createAccumulatorCallbacks` automatically looks up node metadata (label, type) from the workflow
2. The helper maps `StreamAccumulatorCallbacks` to `ExecutionCallbacks`
3. All branch callbacks include the `branchLabel` parameter automatically
4. The `__merge__` branch ID is passed through for parallel node merge steps

### Backward Compatibility:

Existing callbacks that only accept `(nodeId)` continue to work—`NodeInfo` is optional in the new signature.

---

## Required Spec Updates

### 1. ✅ RESOLVED: Node lookup in callback

~~Task 5.3 should specify:~~

> ~~Map `onNodeStart` → lookup node from workflow, then call `accumulator.nodeStart(nodeId, label, type)`~~

**Resolution:** The new `onNodeStart(nodeId, nodeInfo?)` signature and `createAccumulatorCallbacks` helper eliminate manual node lookups.

### 2. Update design.md: Fix timestamp usage

Replace:

```typescript
updated_at: Date.now();
```

With:

```typescript
updated_at: nowSec();
```

### 3. ✅ RESOLVED: Branch callback signatures

~~The `branchToken` method should receive the label separately:~~

**Resolution:** The `createAccumulatorCallbacks` helper handles all branch callback signatures automatically, including the 4-parameter `branchToken` callback.

### 4. ✅ RESOLVED: Handle `__merge__` branch

~~In Phase 3, add:~~

> ~~Handle special `__merge__` branch ID in parallel node visualization~~

**Resolution:** The `__merge__` branch is now documented in or3-workflows. The UI should still display it as "Merging results..." but no special handling is needed in the callback wiring.

### 5. Add task: Reactivity bridge

In Phase 5, add:

> Emit `workflow.execution:action:state_update` hook with reactive state reference
> Subscribe in ChatContainer/useAi to update local workflow state map

---

## Risk Assessment Update

| Risk                               | Severity     | Mitigation                                                | Status            |
| ---------------------------------- | ------------ | --------------------------------------------------------- | ----------------- |
| UI doesn't update during streaming | **Critical** | Implement reactivity bridge via hooks                     | ⚠️ Still required |
| Wrong timestamp format             | Medium       | Use `nowSec()` instead of `Date.now()`                    | ⚠️ Still required |
| Missing node labels                | ~~Medium~~   | ~~Look up node from workflow in callback~~                | ✅ Resolved       |
| Missing branch callbacks           | ~~Medium~~   | ~~Wire all 4 branch callbacks~~                           | ✅ Resolved       |
| `__merge__` branch confusion       | Low          | UI displays as "Merging..." (documented in or3-workflows) | ✅ Documented     |

---

## Conclusion

With the or3-workflows API updates, the spec is now **significantly simpler** to implement:

**Remaining work:**

1. **Critical:** Add reactivity bridge (hook subscription in ChatContainer)
2. **Medium:** Fix timestamp to use `nowSec()`
3. **Low:** Handle `__merge__` branch display in UI

**Resolved by or3-workflows updates:**

1. ~~Node lookup in onNodeStart~~ → `NodeInfo` now passed automatically
2. ~~Manual callback wiring~~ → `createAccumulatorCallbacks` helper
3. ~~Missing callbacks~~ → All callbacks (including `onReasoning`, branch callbacks) are now available and documented
4. **Low:** Handle `__merge__` branch ID

With these corrections, the implementation will work as designed with zero breaking changes.
