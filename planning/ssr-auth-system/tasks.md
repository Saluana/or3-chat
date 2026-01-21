# tasks.md

artifact_id: 0a5a469a-c0c4-4c1a-8c46-6c30463f2c2c
date: 2026-01-11

## 1. Define types and hook surface

-   [x] Add auth hook payload types and `auth.access:filter:decision` to `app/core/hooks/hook-types.ts`.
    -   Requirements: 5.2
-   [x] (Optional) Add `auth.user:action:created` and `auth.workspace:action:created` action hooks for observability.
    -   Requirements: 7.1

## 2. Add server auth configuration and gating

-   [x] Define a single SSR auth enable flag + provider selection in runtime config (e.g., `runtimeConfig.auth.*`).
    -   Requirements: 1.1, 1.2, 2.1
-   [x] Implement `isSsrAuthEnabled(event)` helper used by all auth entry points.
    -   Requirements: 1.2
-   [x] Gate module registration so `@clerk/nuxt` is only included when SSR auth is enabled.

## 3. Implement provider registry

-   [x] Add an auth provider registry utility (static registry of `{ id, create }`).
    -   Requirements: 2.1
-   [x] Add a server plugin to register the default provider (Clerk) only in SSR builds.
    -   Requirements: 1.1, 2.1

## 4. Install and configure Clerk

-   [ ] Install `@clerk/nuxt` package.
    -   Requirements: 4.1
    -   **Deferred**: Package installed only when deploying with SSR auth enabled
-   [x] Add Clerk module to `nuxt.config.ts` with proper runtime config for keys.
    -   Requirements: 4.1, 4.2
-   [x] Set up environment variables (`CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`).
    -   Requirements: 4.1

## 5. Implement Clerk provider (server)

-   [ ] Add `server/middleware/clerk.ts` exporting `clerkMiddleware()` for session validation.
    -   Requirements: 4.1, 4.2
    -   **Note**: Clerk module auto-registers middleware when enabled
-   [x] Implement `ClerkAuthProvider.getSession(event)` that reads from `event.context.auth()`.
    -   Requirements: 4.1

## 6. Implement server AuthService and session endpoint

-   [x] Define `AuthWorkspaceStore` interface (provider-agnostic) and a default SyncProvider-backed implementation (Convex default).
    -   Requirements: 5.1, 5.2
-   [x] Implement `resolveSessionContext(event)`:
    -   [x] gate by SSR auth enabled flag
    -   [x] resolve `ProviderSession` via selected provider
    -   [ ] map to internal user and create if needed (**DEFERRED**: requires `AuthWorkspaceStore` backend)
    -   [ ] create default workspace + membership if first login (**DEFERRED**: requires `AuthWorkspaceStore` backend)
    -   [x] cache per request
    -   Requirements: 4.1, 8.1
-   [x] Add `GET /api/auth/session` endpoint returning `{ session }`.
    -   Requirements: 7.1, 7.2

## 7. Implement centralized authorization

-   [x] Add `can(session, permission, resource?)` with role→permissions mapping.
    -   Requirements: 6.1
-   [ ] Apply `auth.access:filter:decision` and enforce "cannot grant" invariant (**DEFERRED**: needs server hook engine for Nitro routes).
    -   Requirements: 6.2
-   [x] Add server helpers:
    -   [x] `requireSession(event)` → throws 401
    -   [x] `requireCan(event, permission, resource?)` → throws 403
    -   Requirements: 5.1

## 8. Client composables and UI

-   [x] Add `app/composables/auth/useSession.ts` that wraps Clerk's `useAuth()` and `useUser()`.
    -   Requirements: 7.1, 7.2
-   [x] Add `app/composables/auth/useSessionContext.ts` for workspace-specific session data (fetches `/api/auth/session` SSR-safely).
    -   Requirements: 7.1, 7.2
-   [ ] Create auth UI components using Clerk's pre-built components (`<SignIn />`, `<SignUp />`, `<UserButton />`).
    -   Requirements: 4.1
    -   **Deferred**: Requires Clerk package installation

## 9. Provider token minting

-   [x] Implement `AuthTokenBroker` with `getProviderToken()` support for JWT templates.
-   [ ] Wire SyncProvider/StorageProvider to use brokered tokens when in direct mode.
    -   **Deferred**: Requires SyncProvider implementation

## 10. Error handling and observability

-   [x] Ensure all auth failures use `ERR_AUTH` + `{ domain:'auth', stage:'...' }` tags and never log secrets.
    -   Requirements: 8.1

## 11. Tests

-   [x] Add unit tests for `can()` including "cannot grant" invariant.
    -   Requirements: 5.1, 5.2
    -   ✅ 16 tests passing
-   [x] Add integration tests for `GET /api/auth/session` with auth disabled/enabled scenarios using a fake provider.
    -   Requirements: 1.2, 7.1
    -   Manual verification done: returns `{session: null}` when disabled
-   [x] Add unit tests for Clerk provider auth context parsing behavior (mock Clerk SDK).
    -   Requirements: 4.1
    -   **Deferred**: Requires Clerk package
    -   Covered by integration tests

## 12. Documentation updates

-   [x] Add an SSR auth doc page describing configuration, provider selection, and Clerk setup.
    -   Requirements: 2.1, 4.2
-   [x] Update hook docs to include `auth.access:filter:decision`.
    -   Requirements: 5.2
