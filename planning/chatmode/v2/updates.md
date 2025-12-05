# v2 Documentation Updates Overview

This note highlights what changed between the original chatmode planning docs and the new v2 set (architecture, design, requirements, tasks).

## Structural Changes
- Added a v2 directory with four refreshed documents (`architecture.md`, `design.md`, `requirements.md`, `tasks.md`) focused on workflow rendering inside chat.
- Introduced consistent discriminated message typing (`data.type`) across all documents to normalize how workflow vs. non-workflow messages are handled.

## Architecture: Key Deltas
- **Rendering split**: v2 proposes a dedicated `WorkflowChatMessage.vue` selected conditionally by `ChatMessage.vue`, instead of overloading the existing component without a discriminator.
- **Reactive bridge**: v2 mandates broadcasting workflow accumulator state through the same reactive channel as streaming chat (hooks or `useAi` mutators) rather than relying on Dexie writes alone.
- **Error system**: v2 requires using the centralized or3 error/alert tooling for workflow failures; prior docs did not connect to the shared system.
- **Theme integration**: v2 calls for using the established theme system (`app/themes`, `plugins/theme.ts`) with semantic tokens instead of ad-hoc CSS variables.
- **Default message typing**: All non-workflow messages now normalize to `data.type = 'message'`, enabling discriminated unions for safety and rendering clarity.

## Design: Key Deltas
- Adds a workflow-specific rendering stack (`WorkflowChatMessage.vue` → `WorkflowExecutionStatus.vue`) with clear prop contracts and slot/emit guidance.
- Clarifies that workflow rendering must consume a reactive `workflowStates` map keyed by message id to stay in sync with streaming updates.
- Specifies theme token usage (surface, border, accent, warning/error) for workflow UI elements; prior design lacked theme-first guidance.
- Emphasizes branching support (including `__merge__`) and adapter-driven callbacks via `createAccumulatorCallbacks`.

## Requirements: Key Deltas
- Explicitly requires message discriminators, theme-system adherence, and centralized error UX for workflows.
- Adds persistence/timestamp expectations (`nowSec()` and throttled snapshots) plus stop/error/finalization behaviors.
- Introduces accessibility expectations tied to the theme system (contrast-safe colors, semantic states).

## Tasks: Key Deltas
- Breaks implementation into phases that start with schema/type normalization (`data.type` defaulting) before UI work.
- Adds tasks for wiring the reactive bridge, integrating the error system, and applying theme tokens during UI implementation.
- Includes test hardening around workflow rendering (node/branch streaming, stopping, error paths) rather than generic checklist items.
