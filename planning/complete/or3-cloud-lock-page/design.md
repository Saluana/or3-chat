---
artifact_id: da8f69a5-0bea-4287-9ff7-16225f664671
title: Design - OR3 Cloud lock page
status: draft
owner: platform
date: 2026-03-08
---

# Overview

This design adds an optional OR3 Cloud lock page that lives at a dedicated public route and acts as the redirect target for visitors who are not yet allowed into the authenticated app.

The design keeps to existing OR3 constraints:

- off by default,
- SSR-auth gated,
- static builds unchanged,
- provider-agnostic auth UI integration,
- simple route-based control flow,
- optional override surface for branded lock-page content.

The built-in default is a simple auth-first page. Deployments can register a custom replacement for branded landing pages, sales pages, invite-only messaging, or other pre-auth experiences. Forks can also replace the route file directly if they want a hard-coded app-specific page.

# Current-state findings

1. The main app entry routes (`/`, `/chat`, `/docs`) all converge on [`PageShell`](/Users/brendon/Documents/or3/or3-chat/app/components/PageShell.vue), which makes them easy to classify as one protected route group.
2. SSR auth state already flows through [`useSessionContext`](/Users/brendon/Documents/or3/or3-chat/app/composables/auth/useSessionContext.ts), backed by `/api/auth/session`, so the lock page does not need a second auth service.
3. OR3 already uses small registries for swappable UI surfaces, including the auth UI adapter registry in [`app/core/auth-ui/registry.ts`](/Users/brendon/Documents/or3/or3-chat/app/core/auth-ui/registry.ts).
4. Admin already has a dedicated route boundary and login surface at [`app/pages/admin/login.vue`](/Users/brendon/Documents/or3/or3-chat/app/pages/admin/login.vue) plus [`app/middleware/admin-auth.ts`](/Users/brendon/Documents/or3/or3-chat/app/middleware/admin-auth.ts); the lock page must not intercept those routes.
5. Authorization remains centralized in [`server/auth/can.ts`](/Users/brendon/Documents/or3/or3-chat/server/auth/can.ts); the lock page should not create a parallel server auth model.

# Architecture

```mermaid
flowchart LR
    A[Route request] --> B[lock-page.global middleware]
    B --> C[public runtime lock config]
    B --> D[session/access check]
    C --> E[Route classifier]
    D --> F[Access decision]
    E --> F
    F -->|allow| G[Normal route render]
    F -->|redirect| H[/welcome]
    H --> I[Lock Page Resolver]
    I --> J[Custom lock page adapter]
    I --> K[Default lock page]
    K --> L[Auth UI adapter registry]
```

## Route model

V1 uses a dedicated route for the lock experience:

- `/welcome`

Protected routes are the shared shell routes that already render `PageShell`:

- `/`
- `/chat`
- `/chat/**`
- `/docs`
- `/docs/**`

Explicit bypasses:

- `admin.basePath` and children,
- `${admin.basePath}/login`,
- `/welcome`,
- other non-shell routes remain unchanged in V1 unless added later.

This is the simplest design that still locks the real app entry points and keeps admin reachable.

## Configuration surface

The feature belongs under OR3 Cloud auth config because it only matters in SSR auth deployments and depends on auth/access policy.

### Proposed config shape

```ts
export interface Or3CloudAuthLockPageConfig {
    enabled?: boolean;
    adapter?: string;
}
```

Proposed placement:

```ts
export interface Or3CloudConfig {
    auth: {
        enabled: boolean;
        provider: string;
        guestAccessEnabled?: boolean;
        lockPage?: Or3CloudAuthLockPageConfig;
    };
}
```

Resolved defaults:

```ts
lockPage: {
    enabled: false,
    adapter: 'default',
}
```

### Env mapping

Additive env keys:

- `OR3_AUTH_LOCK_PAGE_ENABLED`
- `OR3_AUTH_LOCK_PAGE_ADAPTER`

Notes:

- ignored when `SSR_AUTH_ENABLED !== 'true'`,
- preserved by config tooling and wizard env merging,
- public runtime config only needs non-secret lock-page metadata plus `admin.basePath`,
- the public lock route stays fixed at `/welcome` in V1.

## Core components

### 1. Lock page adapter registry

New client/SSR-safe registry patterned after the auth UI adapter registry:

```ts
import type { Component } from 'vue';

export interface LockPageAdapter {
    id: string;
    component: Component;
}

export function registerLockPageAdapter(input: LockPageAdapter): void;
export function unregisterLockPageAdapter(id: string): void;
export function resolveLockPageAdapter(id: string): LockPageAdapter | null;
```

Responsibilities:

- lets deployments register a custom lock page,
- keeps fallback behavior deterministic,
- keeps `/welcome` simple,
- gives plugin-based customisation without blocking forks from replacing the page file directly.

### 2. Global route middleware

Add a dedicated global route middleware, for example:

- `app/middleware/lock-page.global.ts`

Responsibilities:

- run only when SSR auth and lock-page config are enabled,
- classify whether the current route is protected,
- bypass admin routes using `runtimeConfig.public.admin?.basePath ?? '/admin'`,
- bypass `/welcome` to avoid loops,
- redirect locked visitors to `/welcome`,
- preserve the intended destination via a `next` query string.

Pseudo-flow:

```ts
export default defineNuxtRouteMiddleware(async (to) => {
    if (!ssrAuthEnabled || !lockPageEnabled) return;
    if (isAdminRoute(to.path, adminBasePath)) return;
    if (to.path === lockPageRoute) return;
    if (!isProtectedShellRoute(to.path)) return;

    const access = await resolveLockPageAccess();
    if (access.allowed) return;

    return navigateTo({
        path: lockPageRoute,
        query: { next: to.fullPath },
    });
});
```

Why middleware instead of `PageShell` gating:

- simpler mental model,
- cleaner admin bypass,
- no need to partially render shell routes before deciding,
- gives a stable public route developers can replace or style however they want.

### 3. Lock access resolver helper

The middleware should call a small shared helper/composable:

```ts
export interface LockPageAccessResult {
    allowed: boolean;
    reason:
        | 'disabled'
        | 'ssr-auth-disabled'
        | 'authenticated'
        | 'guest-allowed'
        | 'unauthenticated'
        | 'session-error';
}
```

Decision rules:

1. If SSR auth is disabled: `allowed = true`.
2. If lock page is disabled: `allowed = true`.
3. If session is authenticated and has app access: `allowed = true`.
4. If deployment guest access permits unauthenticated entry: `allowed = true`.
5. Otherwise: `allowed = false`.
6. If session resolution errors while the feature is enabled: `allowed = false`.

This keeps the feature aligned with existing session behavior instead of introducing a second access service.

### 4. Lock page route component

Add a stable route and a default renderer:

- route: `app/pages/welcome.vue`
- default renderer: `app/components/lock-page/DefaultLockPage.vue`

Responsibilities:

- `app/pages/welcome.vue` acts as the stable public route entry,
- resolve the configured adapter and fall back to the built-in default,
- show site branding and concise access messaging,
- render provider-owned auth UI via the existing auth UI adapter registry,
- optionally show legal links from base OR3 config,
- redirect authenticated users back to `next` or `/`,
- remain generic enough that it works for basic-auth, Clerk, or future providers.

Important detail:

- the default component must resolve provider UI through `resolveAuthUiAdapter(...)`,
- it must not import Clerk or provider SDKs directly from core entry code.

## Override model

Developers can register custom lock pages from app/plugin code:

```ts
import MyLandingPage from '~/components/custom/MyLandingPage.vue';
import { registerLockPageAdapter } from '~/core/lock-page/registry';

export default defineNuxtPlugin(() => {
    registerLockPageAdapter({
        id: 'marketing',
        component: MyLandingPage,
    });
});
```

Then select it in config:

```ts
export const or3CloudConfig = defineOr3CloudConfig({
    auth: {
        enabled: true,
        provider: 'basic-auth',
        lockPage: {
            enabled: true,
            adapter: 'marketing',
        },
    },
});
```

Fork-friendly behavior:

- plugin/registry override is the supported extension path,
- forks can replace `app/pages/welcome.vue` directly if they want project-specific control without keeping the generic adapter seam.

Fallback behavior:

1. resolve configured adapter id,
2. if not found, use built-in default,
3. if custom component throws during lazy resolution, log and use built-in default on the next safe render path.

## SSR and static-build behavior

### SSR deployments

- feature can be enabled,
- route middleware can redirect before shell routes render,
- `/welcome` can render on the first response without flashing the app shell.

### Static deployments

- feature is inert,
- no server auth session exists,
- current local-first behavior remains unchanged.

This avoids turning the lock page into a hidden dependency for static builds.

## Error handling

| Scenario | Behavior |
|---|---|
| Config enables lock page but adapter id is unknown | Log warning, render default lock page |
| Session fetch fails while lock page enabled | Fail closed, redirect to `/welcome` and render lock/error state instead of shell |
| Auth provider adapter missing | Default lock page shows non-destructive unavailable/auth-misconfigured state |
| SSR auth disabled | Lock page feature ignored |

## Performance considerations

- Redirect before the main `PageShell` setup to avoid unnecessary pane/sidebar/dashboard work.
- Reuse existing session helpers or the same `/api/auth/session` path already used by auth-aware client flows.
- Keep adapter lookup in an in-memory registry.
- Keep route classification small and explicit for V1.

## Security considerations

- The lock page only controls app-entry routing; it is not a substitute for API authorization.
- Existing server routes continue to use `resolveSessionContext()` and `can()` as the real enforcement boundary.
- Fail closed on access-resolution errors when the feature is enabled.
- Admin routes must be explicitly bypassed using configured `admin.basePath`, not hard-coded `/admin` only.

# Testing strategy

## Unit

1. Config parsing/defaults for `auth.lockPage`.
2. Protected-route classification:
   - `/`, `/chat`, `/docs` protected,
   - `/welcome` bypassed,
   - admin base path bypassed.
3. Access decision matrix:
   - feature disabled,
   - SSR auth disabled,
   - authenticated allowed user,
   - guest allowed,
   - unauthenticated denied,
   - session error.
4. Registry resolution and fallback to default adapter.

## Integration

1. Protected routes redirect to `/welcome` when the feature is enabled and access is denied.
2. `/welcome` renders the configured custom lock page when adapter exists.
3. Protected routes render normally when access is allowed.
4. Unknown adapter id falls back cleanly to the default lock page.
5. Admin routes are never redirected through `/welcome`.

## SSR/auth integration

1. SSR first render of `/` redirects denied users to `/welcome`.
2. Authenticated session reaches the normal shell without lock-page flash.
3. Guest-access-enabled deployment bypasses the lock page according to policy.
4. `/admin` and `/admin/login` remain reachable while the lock page is enabled.

## Manual verification

1. Enable lock page with default adapter on `basic-auth` deployment.
2. Verify `/`, `/chat`, and `/docs` redirect to `/welcome` when signed out.
3. Sign in and verify the shell appears immediately after session refresh.
4. Verify `/admin` and `/admin/login` bypass the lock page.
5. Register a custom adapter and verify config switches to it without core edits.

# Minimal implementation direction

Prefer the smallest end-to-end slice:

1. Add typed config and env parsing.
2. Add lock page registry + default component.
3. Add `/welcome` route plus global lock-page middleware.
4. Add the access helper used by middleware and `/welcome`.
5. Add tests.
6. Update OR3 Cloud config docs and wizard/config preservation.
