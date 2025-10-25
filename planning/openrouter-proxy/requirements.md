artifact_id: 7b5f9a3a-2b92-4b4c-a8a8-1f2e8e2e1d7a

## Introduction

Implement a minimal server-side streaming proxy for OpenRouter in Nuxt/Nitro that prefers a server environment API key but seamlessly falls back to a client-provided API key when the server key is absent. Keep the existing client-side parser (`app/utils/chat/openrouterStream.ts`) and event shape unchanged. Minimize new code and preserve a client-only fallback if the server route is unavailable.

## Requirements

1. Server proxy with env-or-client API key

-   User Story: As a developer, I want the server to use `process.env.OPENROUTER_API_KEY` when set, otherwise use an API key sent from the client, so that the same app works in both hosted (server-key) and local/personal-key scenarios.
-   Acceptance Criteria:
    -   WHEN the server receives a request AND `process.env.OPENROUTER_API_KEY` is defined THEN it SHALL forward requests to OpenRouter using the env key.
    -   WHEN the server receives a request AND `process.env.OPENROUTER_API_KEY` is not defined AND the request body includes an `apiKey` THEN it SHALL forward using that client key.
    -   IF neither key is available THEN the server SHALL respond `400` with a clear error message (no streaming).

2. SSE pass-through and Abort propagation

-   User Story: As a user, I want uninterrupted streaming and proper cancellation.
-   Acceptance Criteria:
    -   WHEN streaming from OpenRouter THEN the server SHALL set `Content-Type: text/event-stream` and pass chunks through without buffering.
    -   WHEN the client connection closes or aborts THEN the server SHALL abort the upstream fetch promptly.

3. Client auto-detection and safe fallback

-   User Story: As a developer, I want the client to call the server route when available without extra configuration, and still work without a server.
-   Acceptance Criteria:
    -   WHEN the client calls `openRouterStream` THEN it SHALL attempt the server route (`/api/openrouter/stream`) first, sending the full request body plus `apiKey`.
    -   IF the server route is missing/unreachable THEN the client SHALL fall back to direct OpenRouter access using the provided `apiKey` (existing behavior).
    -   The event shape (ORStreamEvent) SHALL remain unchanged for downstream UI.

4. Security and logging hygiene

-   User Story: As a security-conscious operator, I need to avoid leaking secrets.
-   Acceptance Criteria:
    -   The server SHALL not log the API key in any logs (env or client-provided); any structured logging SHALL redact keys.
    -   The server SHALL not persist or echo back the API key.

5. Minimal changes, backward compatibility

-   User Story: As a maintainer, I want minimal, low-risk changes.
-   Acceptance Criteria:
    -   The only new code SHALL be a Nitro route and a small change in `openRouterStream` to try the server endpoint first; existing parsing logic remains untouched.
    -   All existing consumers of `openRouterStream` SHALL require no changes.

6. Server-side parsing and normalization (shared parser)

-   User Story: As a developer, I want the server to handle provider-specific SSE parsing when available to reduce client work and keep behavior consistent, while reusing the same parsing logic on the client during fallback.
-   Acceptance Criteria:
    -   The parsing logic SHALL be extracted into a shared isomorphic module used by both the server route and the client fallback.
    -   WHEN using the server route, it SHALL normalize upstream SSE into the same `ORStreamEvent` shape before streaming to clients.
    -   WHEN falling back to direct client mode, the client SHALL use the same shared parser locally to produce identical `ORStreamEvent`s.
    -   This change SHALL not alter the public event shape consumed by the UI.
