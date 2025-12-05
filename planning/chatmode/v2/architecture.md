# Workflow Chat Rendering v2 — Architecture

## Purpose
Provide a simplified, forward-compatible plan for rendering workflow executions inside chat while honoring existing or3-chat constraints (message schema, hook system, theming) and the latest or3-workflows APIs.

## Key Decisions
- **Message discriminator**: `message.data.type` must be set to one of `workflow-execution` or `message` (default). Non-workflow chat entries automatically receive `data.type = 'message'` during normalization to ensure predictable narrowing.
- **Dedicated rendering shell**: Introduce `WorkflowChatMessage.vue` used by `ChatMessage.vue` via conditional slot/component mapping. Keeps the base component lean while allowing workflow-specific layout, theming hooks, and error surfacing.
- **Reactive bridge required**: Workflow execution state must be pushed through the same reactive channel used by streaming chat (hooks or `useAi` mutators). Dexie writes alone are insufficient for UI updates.
- **Or3 error system**: Surface errors using the existing error/alert utilities (same pattern as chat send failures) so workflow issues respect centralized logging and UX conventions.
- **Theme-first styling**: All UI tokens must leverage the app theme system (`app/themes`, `plugins/theme.ts`) instead of ad-hoc CSS variables. Components expose semantic CSS vars only as overrides of theme tokens.

## High-Level Flow
1. **Slash command intercept** detects workflow intent and creates a placeholder assistant message with `data.type = 'workflow-execution'` and initial empty execution payload.
2. **Execution adapter** (or3-workflows) streams callbacks into a **WorkflowStreamAccumulator** that holds reactive state.
3. **Reactivity bridge** emits `workflow.execution:action:state_update` (or exposes `setWorkflowState`) so `ChatContainer` updates a `workflowStates` map keyed by message id.
4. **Render path**: `ChatMessage.vue` checks the discriminator; workflow messages render via `WorkflowChatMessage.vue`, others render normally using `ChatMessageBody` with `data.type = 'message'` defaulting logic.
5. **Persistence**: Accumulator persists snapshots via throttled Dexie writes using `nowSec()` timestamps. Reactive updates continue independently of persistence schedule.
6. **Termination**: Adapter stop propagates to accumulator.finalize; UI reflects `stopped`, `error`, or `completed` states and uses the shared error UX.

## Component Boundaries
- **ChatMessage.vue**: Chooses between `WorkflowChatMessage` and the standard body. Keeps prop signatures stable; receives `UiChatMessage` with optional `workflowState`.
- **WorkflowChatMessage.vue**: Displays execution metadata, timeline, branches, and final output. Emits standardized events for retry/stop leveraging existing error handling actions.
- **WorkflowExecutionStatus.vue** (inner): Pure presentational timeline with theme tokens, no data fetching.
- **WorkflowStreamAccumulator**: Reactive store with RAF batching, branch/token tracking, and serialization via `toMessageData`. Exposes readonly state for UI.
- **Hook/Composable bridge**: Either a dedicated hook topic (`workflow.execution:action:state_update`) or `useAi.setWorkflowState(messageId, state)` to keep Vue reactivity in sync.

## Data Contracts
- **Workflow message data**
  - `type: 'workflow-execution'`
  - `workflowId`, `workflowName`, `prompt`
  - `executionState: 'running' | 'completed' | 'error' | 'stopped' | 'interrupted'`
  - `nodeStates: Record<string, NodeState>` with label/type from or3-workflows `NodeInfo`
  - `branches: Record<string, BranchState>` including `__merge__`
  - `executionOrder: string[]`, `currentNodeId: string | null`, `finalOutput: string`
  - `result?: { success: boolean; durationMs?: number; totalTokens?: number; error?: string }`
- **Default chat message data**
  - For all non-workflow messages, normalization sets `data = { type: 'message' }` unless already populated. Provides a stable discriminator for future extensions.

## Security and Robustness
- **Type narrowing** via discriminated unions prevents rendering arbitrary `data` shapes.
- **Error handling** uses centralized error reporter to avoid silent failures; propagate adapter errors through `nodeError` and `finalize({ error })`.
- **Stop safety**: `stop()` guards against double-finalize; accumulator is idempotent after finalization.
- **Theme consistency** prevents inline colors that could degrade contrast; rely on theme tokens for accessibility.
- **Timestamp correctness**: Always use `nowSec()` for persistence to match schema expectations.

## Open Points
- **Branch visualization**: `__merge__` branch should be labeled as "Merging" and optionally hidden unless verbose mode is enabled.
- **Telemetry**: Consider emitting token usage via `onTokenUsage` into analytics pipeline; not required for MVP.
