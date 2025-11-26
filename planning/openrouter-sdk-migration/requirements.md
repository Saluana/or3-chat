# OpenRouter SDK Migration - Requirements

## Introduction

This document outlines the requirements for migrating the OR3 Chat codebase from direct `fetch()` calls to the official OpenRouter TypeScript SDK (`@openrouter/sdk`). The migration aims to improve type safety, reduce boilerplate code, centralize OpenRouter integration, and provide a foundation for future API changes while maintaining 100% behavioral compatibility with the existing implementation.

## Scope

### Files Affected
1. `app/core/auth/models-service.ts` - Models list fetching
2. `app/core/auth/openrouter-auth.ts` - OAuth code exchange
3. `app/plugins/EditorAutocomplete/TiptapExtension.ts` - Editor autocomplete (non-streaming)
4. `app/utils/chat/openrouterStream.ts` - Client-side streaming chat
5. `server/api/openrouter/stream.post.ts` - Server-side streaming proxy

---

## Functional Requirements

### 1. SDK Installation and Configuration

**User Story:** As a developer, I want the OpenRouter SDK properly installed and configured, so that I can use typed SDK methods instead of raw fetch calls.

**Acceptance Criteria:**
- WHEN the project is built THEN `@openrouter/sdk` SHALL be installed as a dependency
- WHEN the SDK is imported THEN TypeScript SHALL recognize all SDK types without errors
- WHEN the SDK is configured THEN it SHALL support both SSR and client-side environments

### 2. SDK Adapter Layer

**User Story:** As a developer, I want a centralized adapter layer for OpenRouter SDK access, so that SDK configuration and key management are handled consistently across the application.

**Acceptance Criteria:**
- WHEN the adapter is initialized THEN it SHALL provide a singleton-like access pattern for SDK clients
- WHEN an API key changes (e.g., after OAuth login) THEN the adapter SHALL allow updating the key without full reinitialization
- WHEN making SDK calls THEN the adapter SHALL inject common headers (`HTTP-Referer`, `X-Title`) consistently
- WHEN running on the server THEN the adapter SHALL prefer `OPENROUTER_API_KEY` env variable if set
- WHEN running on the client THEN the adapter SHALL use the user's stored API key from state/localStorage

### 3. Models List Migration

**User Story:** As a user, I want to see the list of available OpenRouter models, so that I can choose which model to use for chat.

**Acceptance Criteria:**
- WHEN `fetchModels()` is called THEN it SHALL use `openRouter.models.list()` from the SDK
- WHEN models are fetched successfully THEN the response SHALL be cached in localStorage with the same TTL (1 hour)
- WHEN the cache is valid THEN no network request SHALL be made
- IF the network request fails THEN cached data SHALL be returned as fallback
- WHEN models are returned THEN the type SHALL match `OpenRouterModel[]` interface already defined
- WHEN no API key is available THEN the request SHALL still work (OpenRouter models endpoint is public)

### 4. OAuth Code Exchange Migration

**User Story:** As a user, I want to authenticate with OpenRouter using PKCE OAuth flow, so that I can use my OpenRouter account with OR3 Chat.

**Acceptance Criteria:**
- WHEN `exchangeOpenRouterCode()` is called THEN it SHALL use `openRouter.oAuth.exchangeAuthCodeForAPIKey()` from the SDK
- WHEN the exchange is successful THEN the returned key SHALL be stored in `state.value.openrouterKey` and persisted to IndexedDB
- IF the exchange fails THEN an appropriate `ExchangeResult` with `ok: false` SHALL be returned
- WHEN an error occurs THEN it SHALL be reported via the existing `reportError()` mechanism
- WHEN the SDK method is called THEN it SHALL accept `code`, `codeVerifier`, and `codeChallengeMethod` parameters

### 5. Editor Autocomplete Migration

**User Story:** As a user writing in the editor, I want AI-powered autocomplete suggestions, so that I can write faster.

**Acceptance Criteria:**
- WHEN autocomplete is triggered THEN it SHALL use `openRouter.chat.send()` from the SDK
- WHEN making the request THEN it SHALL include the system prompt and user content as messages
- WHEN the response is received THEN it SHALL extract `choices[0].message.content` for the suggestion
- IF no API key is available THEN an error SHALL be thrown
- WHEN an AbortSignal is provided THEN the request SHALL be cancellable via `fetchOptions.signal`
- WHEN the request fails THEN the error message SHALL be extracted and displayed appropriately

### 6. Streaming Chat - Server Proxy

**User Story:** As a user, I want to stream chat responses from OpenRouter through the server, so that my API key is protected and the connection is reliable.

**Acceptance Criteria:**
- WHEN a streaming request is received THEN the server SHALL proxy it to OpenRouter with SSE enabled
- WHEN an env API key is configured THEN it SHALL be preferred over the client-provided key
- WHEN no env key exists THEN the client-provided Authorization header key SHALL be used
- WHEN the upstream responds THEN the SSE stream SHALL be piped directly to the client unchanged
- IF the client disconnects THEN the upstream request SHALL be aborted via AbortController
- WHEN upstream returns an error THEN the status and error body SHALL be forwarded to the client
- WHEN making the upstream request THEN it SHALL use fetch with SDK-compatible patterns for consistency

### 7. Streaming Chat - Client Fallback

**User Story:** As a user on a static deployment, I want streaming chat to work directly with OpenRouter, so that the app works without a server.

**Acceptance Criteria:**
- WHEN the server route is unavailable THEN the client SHALL fall back to direct OpenRouter calls
- WHEN streaming directly THEN the response SHALL be parsed using the existing `parseOpenRouterSSE()` function
- WHEN the server route fails once THEN the unavailability SHALL be cached with TTL (15 minutes)
- WHEN the TTL expires THEN the client SHALL retry the server route
- WHEN streaming THEN all event types (text, reasoning, tool_calls, images, done) SHALL be handled correctly

### 8. Error Handling Standardization

**User Story:** As a developer, I want SDK errors to be handled consistently, so that users see appropriate error messages.

**Acceptance Criteria:**
- WHEN an SDK call fails THEN typed SDK error classes SHALL be caught and mapped to user-friendly messages
- WHEN a 401 error occurs THEN it SHALL indicate "Invalid or expired API key"
- WHEN a 402 error occurs THEN it SHALL indicate "Insufficient credits"
- WHEN a 429 error occurs THEN it SHALL indicate "Rate limit exceeded"
- WHEN a 5xx error occurs THEN it SHALL indicate "OpenRouter service error"
- WHEN mapping errors THEN existing `reportError()` patterns SHALL be preserved

---

## Non-Functional Requirements

### 9. Type Safety

**User Story:** As a developer, I want strong TypeScript types throughout the OpenRouter integration, so that bugs are caught at compile time.

**Acceptance Criteria:**
- WHEN SDK methods are called THEN parameters SHALL use SDK-defined types
- WHEN SDK responses are received THEN they SHALL be strongly typed (no `any` or manual casting)
- WHEN building the project THEN there SHALL be zero TypeScript errors related to SDK usage
- WHEN refactoring THEN IDE autocomplete and type checking SHALL work correctly

### 10. Bundle Size

**User Story:** As a user, I want the app to load quickly, so that I can start chatting without delay.

**Acceptance Criteria:**
- WHEN the SDK is bundled THEN the total added bundle size SHALL not exceed 50KB gzipped
- WHEN importing SDK functions THEN tree-shaking SHALL be used via standalone functions where beneficial
- WHEN the SDK is loaded THEN it SHALL not block initial page render

### 11. Backward Compatibility

**User Story:** As a user, I want the app to work exactly as before after the migration, so that my workflows are not disrupted.

**Acceptance Criteria:**
- WHEN models are displayed THEN they SHALL appear identical to pre-migration
- WHEN OAuth login completes THEN the key SHALL be stored in the same locations
- WHEN streaming responses THEN the UI SHALL update identically (same events, same timing)
- WHEN errors occur THEN the error messages and toasts SHALL be equivalent
- WHEN caching is used THEN the same localStorage keys and TTLs SHALL be maintained

### 12. SSR/Static Compatibility

**User Story:** As a deployer, I want the app to work in both SSR and static generation modes, so that I have deployment flexibility.

**Acceptance Criteria:**
- WHEN running `nuxt dev` THEN the SDK integration SHALL work correctly (SSR mode)
- WHEN running `nuxt generate` THEN the static build SHALL include proper client-side SDK usage
- WHEN the server route is available (SSR) THEN streaming SHALL use the server proxy
- WHEN the server route is unavailable (static) THEN streaming SHALL fall back to direct client calls

### 13. Testing

**User Story:** As a developer, I want the migration to be testable, so that I can verify correctness.

**Acceptance Criteria:**
- WHEN running existing tests THEN all tests SHALL pass without modification
- WHEN adding new tests THEN SDK calls SHALL be mockable via the adapter layer
- WHEN testing error scenarios THEN SDK error classes SHALL be throwable in mocks
