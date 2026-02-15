---
artifact_id: 88b5c85d-e234-44ea-b752-b62f215fa28f
---

# Implementation plan

## 1. Extend background job data model and APIs
- [x] Update background job types to include `kind`, `toolCalls`, and `workflowState` metadata. (Requirements: 1, 2, 6, 8)
- [x] Extend `/api/jobs/:id/status` and `/api/jobs/:id/stream` payloads to include the new metadata fields. (Requirements: 6, 8)
- [x] Add serialization helpers for job metadata deltas to avoid full payloads when polling. (Requirements: 7, 8)

## 2. Introduce hybrid tool registry (server + client)
- [x] Add runtime metadata and server handler registration paths, defaulting to `hybrid`. (Requirements: 2, 3, 4)
- [x] Implement server-side tool registry under `server/**` and update existing client registry to support runtime flags without breaking changes. (Requirements: 2, 3, 4)
- [x] Add a skip/deny path for client-only tools during background execution with clear errors. (Requirements: 2, 3)

## 3. Background tool execution pipeline
- [x] Update background stream loop to capture tool_call events, execute tools server-side, and append tool results. (Requirements: 2, 3, 6)
- [x] Persist tool call states in job metadata and stream updates to SSE/polling clients. (Requirements: 6, 8)
- [x] Enforce tool execution timeouts and max-iteration safeguards in background mode. (Requirements: 7)

## 4. Background workflow execution
- [x] Implement a server workflow execution adapter that can load workflow definitions from the canonical backend and execute them server-side. (Requirements: 1, 5)
- [x] Stream workflow execution state into background job metadata, including HITL requests. (Requirements: 1, 6, 8)
- [x] Add endpoints/actions to resume HITL responses while the job remains active. (Requirements: 1, 5)

## 5. Client integration and UX
- [x] Update background job tracker to apply tool call and workflow state updates to UI message state. (Requirements: 6, 8)
- [x] Reuse existing workflow UI components to render background workflow status. (Requirements: 1, 8)
- [x] Ensure notifications follow hook-based delivery for background completions/errors. (Requirements: 6)

## 6. Security, observability, and hardening
- [x] Gate all background execution endpoints with SSR auth and `can()` checks. (Requirements: 5)
- [x] Add structured logging for background tool/workflow execution with secret redaction. (Requirements: 5, 7)
- [x] Validate payload size limits for tool outputs and workflow state updates. (Requirements: 7)

## 7. Testing
- [x] Add unit tests for tool runtime resolution, job metadata deltas, and workflow event mapping. (Requirements: 1, 2, 3, 6)
- [x] Add integration tests for background tool execution and workflow HITL pause/resume. (Requirements: 1, 2, 6, 8)
- [x] Add E2E tests for reattachment flow and notification emission. (Requirements: 6, 8)
