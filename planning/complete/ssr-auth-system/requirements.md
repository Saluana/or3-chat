# requirements.md

artifact_id: 1c1f66b1-2a70-4f29-9d1d-2bfc9e97c6f9
date: 2026-01-11

## Introduction

This document defines requirements for adding an SSR-only, multi-user authentication and authorization system to OR3 Chat while preserving the existing local-first static build behavior.

Scope (this plan):

-   SSR-only login/session and workspace membership resolution
-   Centralized authorization via `can(session, permission, resource?)`
-   Provider adapter pattern with a default Clerk implementation
-   A single extensibility hook for authorization decisions
-   AuthWorkspaceStore backed by the selected SyncProvider (Convex default)
-   Provider token minting for external backends (JWT templates)

Non-goals (explicitly out of scope for this auth plan):

-   Sync engine (Dexie ↔ server)
-   Admin dashboard UI + plugin management UI
-   Notifications subsystem

## Requirements

### 1. SSR-only auth availability

1.1 As a deployment operator, I want SSR auth to be enabled only when running OR3 in SSR mode, so that static builds remain local-first and do not ship server auth code paths.

-   WHEN the app is deployed as a static build THEN SSR authentication endpoints SHALL be absent or return a deterministic "disabled" response.
-   WHEN SSR auth is disabled THEN the app SHALL continue to function using existing OpenRouter PKCE/local APIs.

    1.2 As a developer, I want a single feature flag/config switch for SSR auth, so that enabling/disabling the subsystem is explicit and testable.

-   WHEN the SSR auth flag is false THEN server session resolution SHALL return null without side effects.

### 2. Provider adapter pattern

2.1 As a developer, I want to implement an `AuthProvider` adapter, so that different auth systems (Clerk, Firebase, Supabase, custom JWT) can be swapped without changing core auth logic.

-   WHEN an auth provider is registered THEN core auth code SHALL only call `provider.getSession(event)`.
-   WHEN multiple providers exist THEN the active provider SHALL be selected by configuration.
-   IF the selected provider cannot be created (misconfig) THEN auth resolution SHALL fail safely (no session) and produce a reportable error.

    2.2 As a plugin author, I want the provider choice and server auth behavior to be extension-friendly, so that OR3 can evolve without hard-coding Clerk throughout the app.

-   WHEN a provider is selected THEN its implementation SHALL be isolated to server-only modules.

### 3. Provider token minting (backend access)

3.1 As a developer, I want to mint backend-specific tokens from the auth provider, so that direct sync providers can authenticate clients without custom glue.

-   WHEN the active auth provider supports JWT templates THEN the system SHALL expose `getProviderToken(providerId)` to obtain a provider-specific token.
-   WHEN a provider token cannot be minted THEN direct sync providers SHALL fall back to server gateway mode or return a clear error.

### 4. Clerk default provider

3.1 As an SSR user, I want to sign in using Clerk's pre-built UI components, so that I get a polished authentication experience with minimal custom code.

-   WHEN the user initiates sign-in THEN the app SHALL use Clerk's `<SignIn />` or `<SignInButton />` components.
-   WHEN signed in THEN the server SHALL be able to validate the session via `@clerk/nuxt` middleware.

    3.2 As an operator, I want secure session defaults managed by Clerk, so that session handling follows best practices without manual cookie management.

-   WHEN a user authenticates THEN Clerk SHALL manage session tokens automatically.
-   WHEN a request reaches the server THEN `clerkMiddleware()` SHALL validate and expose auth state via `event.context.auth()`.

### 5. Workspace as a first-class server entity

4.1 As a newly authenticated user, I want a default workspace to be created on first login, so that the product works immediately without manual setup.

-   WHEN a user logs in for the first time THEN the server SHALL create a default workspace and assign the user an `owner` role.
-   WHEN the user logs in again THEN the server SHALL reuse existing workspace membership.

    4.2 As a single-tenant operator, I want multi-workspace UI to remain optional, so that the UI can stay simple.

-   WHEN only one workspace exists for the user THEN the UI SHALL be able to hide workspace switching.

    5.3 As a developer, I want a single canonical workspace store, so that auth and sync share the same source of truth.

-   WHEN SSR auth is enabled THEN the default `AuthWorkspaceStore` SHALL be backed by the selected SyncProvider backend (Convex default).

### 6. Centralized authorization

5.1 As a developer, I want all authorization checks to flow through `can(session, permission, resource?)`, so that security logic is auditable and consistent.

-   WHEN server routes require authorization THEN they SHALL call `can()` (directly or via a guard helper).
-   WHEN a permission is unknown THEN the decision SHALL default to deny.

    5.2 As a platform owner, I want controlled extensibility for authorization decisions without enabling plugins to grant new powers.

-   WHEN `can()` evaluates a decision THEN it SHALL invoke exactly one hook: `auth.access:filter:decision`.
-   WHEN the hook modifies the decision THEN it SHALL only be able to restrict access (e.g., flip allow → deny) and SHALL NOT be able to grant access if core would deny.

### 7. Session exposure to client code

6.1 As a user, I want the UI to know whether I am authenticated, so that SSR-only features (admin, multi-user) can be conditionally rendered.

-   WHEN authenticated THEN the client SHALL be able to access session state via Clerk's `useAuth()` composable.
-   WHEN unauthenticated THEN the auth state SHALL indicate no active session.

    6.2 As a developer, I want session fetching to be SSR-safe.

-   WHEN running during SSR THEN Clerk's session state SHALL be available via `event.context.auth()`.

### 8. Error handling and observability

7.1 As a developer, I want auth failures to be diagnosable without leaking secrets.

-   WHEN auth resolution fails THEN the system SHALL use the existing error reporting conventions (`ERR_AUTH` with `{ domain:'auth', stage:<...> }`).
-   WHEN responding to clients THEN errors SHALL not include credentials, tokens, or session contents.

### 9. Performance constraints

8.1 As an operator, I want session resolution to be fast and scalable.

-   WHEN a single request performs multiple auth checks THEN session resolution SHALL be cached per-request.
-   WHEN using Clerk SDK THEN session verification SHALL leverage Clerk's built-in caching and JWT validation.
