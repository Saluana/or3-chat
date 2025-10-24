artifact_id: 4c95e3db-4198-44fb-b4b3-1f25f50b42d4

# LLM Tools Registry Tasks

1. Tool Registry Core

    - [x] Create `app/utils/chat/tool-registry.ts` with singleton store, `registerTool`, `unregisterTool`, `listTools`, and `setEnabled` APIs. Requirements: 1, 2, 3, 8, 10
    - [x] Implement handler timeout and argument validation helpers within the registry module. Requirements: 5, 6, 9
    - [x] Persist enabled states to localStorage (`or3.tools.enabled`) and hydrate on first use. Requirements: 3, 7, 8

2. Shared Types & Developer API

    - [x] Extend `ToolDefinition` in `app/utils/chat/types.ts` with optional UI metadata and export `ToolHandler` / `ExtendedToolDefinition` types. Requirements: 1, 2, 10
    - [x] Add a plugin-friendly re-export (e.g., `app/utils/chat/tools-public.ts`) exposing `registerTool` and `unregisterTool`. Requirements: 1, 10

3. Chat Engine Integration

    - [ ] Update `useChat.sendMessage` to collect enabled tool definitions before calling `openRouterStream`. Requirements: 4
    - [ ] Refactor the streaming loop to detect `tool_call`, execute the mapped handler, push `tool` role messages, and restart streaming as needed. Requirements: 5, 6, 9
    - [ ] Cache large tool outputs for LLM history while rendering concise UI summaries. Requirements: 5, 6

4. UI Controls

    - [ ] Inject registry-driven tool toggles into `ChatInputDropper` settings popover with icon + label support. Requirements: 2, 3, 7
    - [ ] Ensure toggles stay in sync with registry state and disable controls while chat is streaming. Requirements: 3, 7

5. Documentation & Examples

    - [ ] Author developer documentation showing how to register/unregister a tool and handle clean-up on plugin unload. Requirements: 1, 2
    - [ ] Add a sample plugin (or update an existing one) that registers a demo tool and verifies enable/disable behavior. Requirements: 1, 3, 5

6. Testing & QA
    - [ ] Unit test the registry module for registration, persistence, and validation logic. Requirements: 1, 3, 7, 9, 10
    - [ ] Integration test the `useChat` tool-call loop using mocked streams. Requirements: 4, 5, 6, 10
    - [ ] Component test `ChatInputDropper` to confirm toggle rendering and interaction. Requirements: 2, 3, 7, 10
