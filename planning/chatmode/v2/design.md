# Workflow Chat Rendering v2 — Technical Design

## Goals
- Render workflow executions inside chat with minimal disruption to existing chat paths.
- Strengthen typing and security via discriminated unions and controlled rendering.
- Adopt theme + error systems from day one.

## Message Modeling
```ts
// Discriminated union for message.data
export type MessageData =
  | { type: 'workflow-execution'; payload: WorkflowExecutionPayload }
  | { type: 'message' }
  | { type: string; [key: string]: unknown }; // forward-compat fallback
```
- **Defaulting**: `normalizeMessageData(data)` returns `{ type: 'message' }` when `data` is null/undefined.
- **UiChatMessage extension**: optional `isWorkflow`, `workflowState` derived from payload; no breaking fields removed.
- **Security**: Renderer narrows via `data?.type === 'workflow-execution'` before reading nested fields.

## Rendering Strategy
- **Conditional component**: `ChatMessage.vue` maps workflow messages to a dedicated `WorkflowChatMessage.vue`; regular messages use existing body renderer. This keeps base chat logic intact and isolates workflow-specific UI/tests.
- **WorkflowChatMessage.vue**
  - Receives `workflowState`, `messageId`, `theme` context.
  - Slots for header/actions to integrate stop/retry buttons using existing command handlers.
  - Uses `WorkflowExecutionStatus.vue` for timeline; leverages theme composables (e.g., `useTheme()` or provided CSS vars) instead of ad-hoc variables.
- **Theming**
  - Use semantic tokens from theme plugin (`--or3-surface`, `--or3-surface-variant`, `--or3-primary`, `--or3-on-surface`, etc.).
  - Allow opt-in overrides through CSS vars but default to theme tokens to avoid later refactors.

## State Flow
1. **Slash command**: Detect workflow intent, enqueue assistant placeholder message with `data.type = 'workflow-execution'` and empty payload.
2. **Accumulator**: `WorkflowStreamAccumulator` receives callbacks from `createAccumulatorCallbacks(workflow, callbacks)` ensuring label/type are populated from `NodeInfo`.
3. **Reactive bridge**: Accumulator publishes state via hook `workflow.execution:action:state_update` or `useAi.setWorkflowState(messageId, stateRef)`. `ChatContainer` subscribes, storing a reactive `Map<id, state>` for rendering.
4. **Persistence**: Throttle Dexie writes (>=500ms) calling `db.messages.put({ id, data: accumulator.toMessageData(...), updated_at: nowSec() })`.
5. **Error/stop**: Adapter errors call `accumulator.nodeError`/`finalize({ error })`; `WorkflowChatMessage` surfaces inline plus triggers shared error reporter (toast/logging). `stop()` cancels adapter and marks executionState `stopped`.

## Accumulator Highlights
- RAF-batched token and branch token flushes into `streamingText`; `version++` drives reactivity.
- Guards against updates after finalize; stop sets `isActive=false` and `executionState='stopped'`.
- Serializes final state with discriminated data for storage.
- Tracks `__merge__` branch; UI labels as "Merging" and can collapse by default.

## Error Handling
- Use existing or3 error utilities (e.g., shared notifier/logging service) instead of ad-hoc `console.error`.
- Inline error rendering per node and a message-level banner for fatal failures.
- Hook events emit error objects for telemetry.

## Accessibility & UX
- Keyboard support for expanding nodes/branches (`details/summary` or button + aria-expanded`).
- Focus states styled via theme tokens.
- Announce status changes (e.g., `aria-live="polite"` for node status text) when feasible.

## Testing Considerations
- Unit: accumulator event sequencing, `normalizeMessageData` defaulting, discriminated rendering selection.
- Component: `WorkflowChatMessage` snapshot under running/error/completed states; theme snapshot to ensure tokens applied.
- Integration: hook bridge updates UI without Dexie, stop/resume actions.
