---
artifact_id: ea1fcee1-c68a-432e-8268-0e18b9ec34b8
---

# Background execution for workflows and tools

## Introduction
Enable background job processing to execute workflows and tool calls while preserving the existing local-first UX, SSR boundaries, and plugin-centric extension model. The goal is to support long-running workflow/tool executions server-side (when SSR is enabled) without breaking existing foreground streaming or tool registration semantics.

## Requirements

1. **Background workflows execution (SSR)**
   - **User Story:** As a signed-in user, I want workflows to keep running in the background so I can navigate away without losing progress.
   - **Acceptance Criteria:**
     - WHEN a workflow execution is requested with background mode enabled THEN the server SHALL continue the workflow execution without a live client connection.
     - WHEN a background workflow finishes THEN the final output SHALL be persisted and visible in the chat history.
     - WHEN a workflow execution requires human-in-the-loop (HITL) input THEN the background job SHALL pause and expose the pending action state to the client.

2. **Background tool execution (SSR)**
   - **User Story:** As a user, I want tool calls triggered by the model to execute in the background so that long tool operations complete even if I switch threads.
   - **Acceptance Criteria:**
     - WHEN a background job receives tool_call events THEN the system SHALL execute eligible tools server-side and append tool results as tool messages for follow-on turns.
     - WHEN tool execution fails THEN the job SHALL record an error state and the assistant response SHALL reflect the failure.

3. **Hybrid tool capability defaults**
   - **User Story:** As a plugin author, I want tools to run both client and server by default so my tool works in foreground and background without extra configuration.
   - **Acceptance Criteria:**
     - WHEN a tool is registered without explicit runtime restrictions THEN it SHALL be treated as hybrid (client + server).
     - WHEN a tool is marked client-only THEN background execution SHALL skip it with a clear error that is surfaced to the assistant response.

4. **Backward compatibility**
   - **User Story:** As a developer upgrading OR3, I want existing foreground tool execution and workflows to keep working with no changes.
   - **Acceptance Criteria:**
     - WHEN background execution is disabled THEN the system SHALL behave exactly as it does today.
     - WHEN tools are registered using existing APIs THEN their behavior in foreground mode SHALL remain unchanged.

5. **Authorization and security**
   - **User Story:** As an operator, I want background execution to respect SSR authorization so data access is safe.
   - **Acceptance Criteria:**
     - WHEN a background job is started THEN the server SHALL authorize the user/workspace using `can()`-gated SSR endpoints.
     - WHEN a background job requests data access THEN the server SHALL enforce workspace scoping and deny cross-workspace access.

6. **Observability and notifications**
   - **User Story:** As a user, I want to receive notifications when background work finishes or fails.
   - **Acceptance Criteria:**
     - WHEN a background job completes and no viewers are attached THEN a notification SHALL be emitted using hook-based notification flows.
     - WHEN a background job errors THEN a warning notification SHALL be emitted with a user-readable message.

7. **Performance and resilience**
   - **User Story:** As an operator, I want background execution to be efficient and bounded.
   - **Acceptance Criteria:**
     - WHEN background execution is active THEN job concurrency and retention limits SHALL be enforced.
     - WHEN a job exceeds timeout thresholds THEN it SHALL be aborted and marked as failed.

8. **Client re-attach and recovery**
   - **User Story:** As a user, I want to re-attach to background work after reloads.
   - **Acceptance Criteria:**
     - WHEN a client reconnects THEN the system SHALL stream job deltas and restore tool/workflow state without losing partial output.
     - WHEN polling is used as fallback THEN deltas SHALL be sent using offsets to minimize payload size.
