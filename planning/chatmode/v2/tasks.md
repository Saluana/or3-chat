# Workflow Chat Rendering v2 — Task Breakdown

## Phase 1 — Data & Types
- Add `normalizeMessageData` that defaults `data` to `{ type: 'message' }` when absent.
- Extend `UiChatMessage` with optional workflow fields; define `WorkflowExecutionPayload`/guards.
- Wire discriminated union into message builders to prevent undefined data shapes.

## Phase 2 — Accumulator & Callbacks
- Implement `WorkflowStreamAccumulator` with RAF batching, branch tracking, finalize/stop safety, and `toMessageData` using `nowSec()`.
- Use `createAccumulatorCallbacks` from or3-workflows to populate labels/types and full branch signatures.
- Emit `onTokenUsage`/metrics as needed.

## Phase 3 — Reactivity Bridge
- Add hook `workflow.execution:action:state_update` or `useAi.setWorkflowState(messageId, stateRef)`; subscribe in `ChatContainer` to keep a reactive `workflowStates` map.
- Ensure Dexie writes are throttled and not relied upon for UI updates.

## Phase 4 — Rendering Layer
- Introduce `WorkflowChatMessage.vue`; integrate into `ChatMessage.vue` via conditional render.
- Implement `WorkflowExecutionStatus.vue` timeline with branch support and `__merge__` labeling.
- Use theme system tokens (from `app/themes` and theme plugin) for colors/spacing/typography.
- Reuse existing markdown renderer for final output; stream content via preformatted block.

## Phase 5 — Controls & Error UX
- Hook stop/retry buttons into existing chat actions; ensure `stop()` is idempotent.
- Surface errors through or3 error system (toast/logging) and inline node/message states.
- Add accessibility: keyboard focus, aria attributes, live region for status updates.

## Phase 6 — Testing & Hardening
- Unit tests for accumulator transitions and data normalization.
- Component tests for workflow rendering under running/completed/error states, including theme snapshots.
- Integration test validating hook-driven updates without Dexie, and stop handling.
