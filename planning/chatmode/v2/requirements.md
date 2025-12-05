# Workflow Chat Rendering v2 — Requirements

## Functional
- **Workflow message support**: Chat must render workflow executions using `data.type = 'workflow-execution'` discriminator.
- **Default discriminator**: New non-workflow messages MUST be normalized to `data.type = 'message'` if `data` is null/undefined.
- **Real-time updates**: UI must reflect execution progress via reactive bridge (hooks or `useAi` setter). Dexie writes alone are insufficient.
- **Stop/retry**: Users can stop an active workflow and retry from the same message, using existing action/command patterns.
- **Branch visibility**: Parallel branches, including `__merge__`, are displayed with status and streamed output.
- **Error surfacing**: Errors propagate to UI through the shared or3 error system (toast/logging) and show inline state on the workflow message.
- **Theming**: Components consume theme tokens from `app/themes`/theme plugin; no hardcoded colors. Support light/dark automatically.
- **Accessibility**: Keyboard navigation for expand/collapse; sufficient contrast via theme tokens; aria labels on controls.

## Non-Functional
- **Backward compatibility**: No schema changes; optional additions only to `UiChatMessage`/types. Existing chat remains unaffected.
- **Performance**: RAF-batched token flush; persistence throttled (>=500ms). Avoid rerender storms by using version counters.
- **Resilience**: `stop()` idempotent; accumulator guards against updates after finalize; handles adapter errors gracefully.
- **Security/Type safety**: Discriminated unions for message data; narrow unknown `data` before rendering; avoid executing arbitrary content from workflow payloads.
- **Observability**: Hook events for state updates and token usage optionally piped into telemetry.

## Data Contracts
- **WorkflowExecutionMessage**
  - `type: 'workflow-execution'`
  - `workflowId: string`
  - `workflowName: string`
  - `prompt: string`
  - `executionState: 'running' | 'completed' | 'error' | 'stopped' | 'interrupted'`
  - `nodeStates: Record<string, NodeState>` (label/type from NodeInfo)
  - `branches: Record<string, BranchState>`
  - `executionOrder: string[]`
  - `currentNodeId: string | null`
  - `finalOutput: string`
  - `result?: { success: boolean; durationMs?: number; totalTokens?: number; error?: string }`
- **DefaultChatMessage**
  - `type: 'message'` (assigned automatically when absent)

## UX Guidelines
- Render workflow messages with a dedicated component to keep standard chat layout unchanged.
- Inline markdown content for final output should reuse existing markdown renderer; streaming text uses monospaced preformatted block.
- Expand/collapse state preserved per message; branch sections collapsible.
- Theme tokens: use semantic vars such as `--color-surface`, `--color-on-surface`, `--color-primary`, drawn from theme plugin helpers.

## Compliance
- Use `nowSec()` for timestamps to match Dexie schema expectations.
- Respect existing hook naming conventions (`workflow.*`) and error system utilities.
