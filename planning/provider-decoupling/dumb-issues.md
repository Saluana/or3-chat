# dumb-issues.md

## 1) “Runtime gating” with compile-time imports (a.k.a. the build still requires Convex)

**Where**
- `app/plugins/convex-sync.client.ts`

**Snippet**
```ts
import { useConvexClient } from 'convex-vue';
import { createConvexSyncProvider } from '~/core/sync/providers/convex-sync-provider';
import { CONVEX_PROVIDER_ID } from '~~/shared/cloud/provider-ids';

// ... later ...
if (runtimeConfig.public.sync?.provider !== CONVEX_PROVIDER_ID) {
  return;
}
```

**Why this is bad**
You’re “skipping sync” at runtime, but you still hard-import Convex modules at the top of an auto-loaded Nuxt plugin. That means:
- Convex is a mandatory dependency even when not used.
- Removing Convex from dependencies breaks the build immediately.

**Real-world consequences**
- “Swappable providers” is a lie.
- Any attempt to ship a non-Convex build or package-based provider strategy fails.

**Concrete fix**
- Replace provider-specific plugin with a thin dispatcher plugin.
- Move provider imports behind `await import(...)` after config checks.

---

## 2) Convex+Clerk bridge plugin hardwires both providers into the client build

**Where**
- `app/plugins/convex-clerk.client.ts`

**Snippet**
```ts
import { useConvexClient } from 'convex-vue';

// reads window.Clerk, assumes Clerk exists
const clerk = (window as any).Clerk;
```

**Why this is bad**
Even if you don’t use Convex or Clerk, the plugin still compiles and forces those dependencies/types into the build graph.

**Real-world consequences**
- You can’t uninstall Clerk or Convex without editing core.
- “provider packages” can’t happen while core auto-loads this.

**Concrete fix**
- Delete/replace with a provider package registration hook.
- Only load this bridge from the Convex provider package when both providers are selected.

---

## 3) Workspace UI is married to Convex (so swapping backend means rewriting UI)

**Where**
- `app/plugins/workspaces/WorkspaceManager.vue`

**Snippet**
```ts
import { useConvexMutation, useConvexQuery } from 'convex-vue';
import { api } from '~~/convex/_generated/api';

const { data: workspaces } = useConvexQuery(api.workspaces.listMyWorkspaces, {});
const createWorkspaceMutation = useConvexMutation(api.workspaces.create);
```

**Why this is bad**
This is supposed to be “OR3 Cloud workspace UX”, not “Convex SDK demo component”.

**Real-world consequences**
- A non-Convex provider can’t implement workspaces without touching UI.
- Removing Convex breaks builds in unrelated UI.

**Concrete fix**
Introduce a tiny `WorkspaceApi` composable interface and have Convex implement it behind a dynamic import.

---

## 4) SSR session provisioning is hardcoded to Convex (it even admits it)

**Where**
- `server/auth/session.ts`

**Snippet**
```ts
// TODO: Abstract this into a provider-agnostic SessionStore interface
// For now, we use Convex directly as it's the only supported sync provider
const { getConvexClient } = await import('../utils/convex-client');
const { api } = await import('~~/convex/_generated/api');
const convex = getConvexClient();

const resolved = await convex.query(api.workspaces.resolveSession, { ... });
```

**Why this is bad**
You already defined `AuthWorkspaceStore`, then completely ignore it and weld auth provisioning to Convex.

**Real-world consequences**
- Any non-Convex canonical store is blocked.
- You can’t extract Convex to a package because core server code imports it.

**Concrete fix**
- Implement `AuthWorkspaceStore` registry + adapters.
- Move Convex provisioning into a Convex-backed store adapter.

---

## 5) Clerk middleware runs whenever SSR auth is enabled (even if provider isn’t Clerk)

**Where**
- `server/middleware/00.clerk.ts`

**Snippet**
```ts
if (config.auth.enabled !== true) return;
const { clerkMiddleware } = await import('@clerk/nuxt/server');
return clerkMiddleware()(event);
```

**Why this is bad**
The gate is wrong. `auth.enabled` is not “use clerk”. It’s “SSR auth on”, which could be any provider.

**Real-world consequences**
- Set provider to custom, keep SSR auth enabled → server still tries to load Clerk.
- Uninstall Clerk → server blows up even if not selected.

**Concrete fix**
Gate by `config.auth.provider === 'clerk'` (or better: a provider dispatcher that loads only the selected provider).

---

## 6) Server registers Clerk auth provider regardless of selected provider

**Where**
- `server/plugins/auth.ts`

**Snippet**
```ts
if (config.auth.enabled !== true) return;
const { clerkAuthProvider } = await import('../auth/providers/clerk');
registerAuthProvider({ id: CLERK_PROVIDER_ID, create: () => clerkAuthProvider });
```

**Why this is bad**
Same mistake as the middleware: it confuses “SSR auth enabled” with “Clerk is the provider”.

**Real-world consequences**
- Provider swap is brittle and surprising.
- Uninstalling Clerk is impossible without patching core.

**Concrete fix**
Only register the provider selected in config (dynamic import via provider loader).

---

## 7) Core server Convex client module makes Convex non-optional

**Where**
- `server/utils/convex-client.ts`

**Snippet**
```ts
import { ConvexHttpClient } from 'convex/browser';
import { api } from '~~/convex/_generated/api';
```

**Why this is bad**
This is core server code importing Convex SDK and generated API. If Convex is supposed to be optional, this file must not exist in core.

**Real-world consequences**
- You cannot remove Convex deps.
- You cannot move Convex backend into a provider package without untangling this.

**Concrete fix**
Move this into the Convex provider package, and have core call a provider-agnostic store/client interface.

---

## 8) Admin adapters hardcode “Clerk tokens for Convex gateway”

**Where**
- `server/admin/providers/adapters/sync-convex.ts`
- `server/admin/providers/adapters/storage-convex.ts`

**Snippet**
```ts
const token = await getClerkProviderToken(event, CONVEX_JWT_TEMPLATE);
```

**Why this is bad**
This bakes in a specific auth provider assumption into a backend adapter. If you swap auth away from Clerk, your admin tools break.

**Real-world consequences**
- Convex admin maintenance becomes unusable without Clerk.
- You can’t claim “auth provider swappable”.

**Concrete fix**
Request provider tokens via a provider-agnostic broker interface (server-side token broker), keyed by the configured auth provider.

---

## 9) Provider IDs are compile-time unions, so external providers require core edits

**Where**
- `shared/cloud/provider-ids.ts`
- `utils/or3-cloud-config.ts` (zod enums)

**Snippet**
```ts
export const AUTH_PROVIDER_ID_LIST = [ 'clerk', 'custom' ] as const;
// ...
provider: z.enum(AUTH_PROVIDER_ID_LIST),
```

**Why this is bad**
If the goal is “installable provider packages”, then the core app cannot hardcode the list. That defeats the entire point.

**Real-world consequences**
- You can’t add `or3-supabase` or `or3-auth0` without modifying core.

**Concrete fix**
- Make provider IDs `string` in config.
- Validate them against runtime-registered providers in strict mode.

---

## 10) Convex backend code is explicitly Clerk-only (which is fine… but only if it’s not core)

**Where**
- `convex/workspaces.ts`
- `convex/auth.config.ts`

**Snippet**
```ts
// Constraints:
// - Only Clerk is supported as an auth provider in this module
const VALID_AUTH_PROVIDER = 'clerk';
```

**Why this is bad**
This is not a problem *inside a Convex provider package*. It’s a problem as long as Convex backend lives inside the core app repo that pretends providers are swappable.

**Real-world consequences**
- You can’t ship non-Clerk auth with Convex backend without deeper work.
- You can’t credibly claim decoupling until Convex backend lives behind a package boundary.

**Concrete fix**
Move Convex backend into `or3-convex` and treat it as the Convex provider’s implementation detail.
