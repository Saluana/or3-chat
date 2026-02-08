# implementation-guide.md

This guide is written for “do it once, keep behavior identical”.

Assumptions (OR3 recommended):
- Providers are selected at install/setup time via the wizard.
- Applying provider changes requires rebuild/restart (no hot-swaps on a running server).
- We preserve current behavior for the default stack (Clerk + Convex): sync realtime, live updates, notifications, admin actions.

Non-negotiable success criteria:
- Core must `bun run build` + `bun run type-check` when Clerk/Convex are uninstalled *and* `convex/_generated/**` is absent (assuming those providers aren’t selected).

---

## 0) Pick the “provider inclusion” mechanism (recommended for the wizard)

Nuxt only runs modules you include at build time. The simplest wizard-friendly approach is:

1) One-time core change: `nuxt.config.ts` imports a generated list of provider modules.
2) Install wizard overwrites the generated file based on the chosen provider(s), then rebuilds.

**Generated file example: `or3.providers.generated.ts`**
```ts
// Overwritten by the install wizard.
// Keep this file tiny and explicit.

export const or3ProviderModules = [
  'or3-provider-clerk/nuxt',
  'or3-provider-convex/nuxt',
] as const;
```

**Core `nuxt.config.ts` sketch**
```ts
import { or3ProviderModules } from './or3.providers.generated';

export default defineNuxtConfig({
  modules: [
    '@nuxt/ui',
    '@nuxt/fonts',
    '@vite-pwa/nuxt',
    ...or3ProviderModules,
  ],
});
```

Why this route:
- No “scan node_modules” discovery.
- Provider set is explicit and reproducible.
- Wizard can safely own updates (install deps + rewrite file + rebuild).

---

## 1) Add the minimal core registries/interfaces (no provider imports)

Core owns contracts + registries. Provider packages call these registries from their Nuxt modules/plugins.

### 1.1 `AuthWorkspaceStore` registry (server)
File sketch: `server/auth/store/registry.ts`
```ts
import type { AuthWorkspaceStore } from './types';

export type AuthWorkspaceStoreFactory = () => AuthWorkspaceStore;
export interface AuthWorkspaceStoreRegistryItem {
  id: string;
  order?: number;
  create: AuthWorkspaceStoreFactory;
}

const stores = new Map<string, AuthWorkspaceStoreRegistryItem>();

export function registerAuthWorkspaceStore(item: AuthWorkspaceStoreRegistryItem): void {
  stores.set(item.id, item);
}

export function getAuthWorkspaceStore(id: string): AuthWorkspaceStore | null {
  const item = stores.get(id);
  return item ? item.create() : null;
}
```

### 1.2 `ProviderTokenBroker` registry (server)
This replaces *all* Clerk-specific token minting in core server code.

File sketch: `server/auth/token-broker/types.ts`
```ts
import type { H3Event } from 'h3';

export interface ProviderTokenRequest {
  providerId: string;
  template?: string;
}

export interface ProviderTokenBroker {
  getProviderToken(event: H3Event, req: ProviderTokenRequest): Promise<string | null>;
}
```

File sketch: `server/auth/token-broker/registry.ts`
```ts
import type { ProviderTokenBroker } from './types';

export type ProviderTokenBrokerFactory = () => ProviderTokenBroker;
const brokers = new Map<string, ProviderTokenBrokerFactory>();

export function registerProviderTokenBroker(id: string, create: ProviderTokenBrokerFactory) {
  brokers.set(id, create);
}

export function getProviderTokenBroker(id: string): ProviderTokenBroker | null {
  return brokers.get(id)?.() ?? null;
}
```

### 1.3 Gateway adapter registries (server)
These are what `/api/sync/*` and `/api/storage/*` call instead of importing Convex APIs.

File sketch: `server/sync/gateway/types.ts`
```ts
import type { H3Event } from 'h3';
import type { PullRequest, PullResponse, PushBatch, PushResult } from '~~/shared/sync/types';

export interface SyncGatewayAdapter {
  id: string;
  pull(event: H3Event, input: PullRequest): Promise<PullResponse>;
  push(event: H3Event, input: PushBatch): Promise<PushResult>;
  updateCursor(event: H3Event, input: { scope: { workspaceId: string }; deviceId: string; version: number }): Promise<void>;
  gcTombstones?(event: H3Event, input: { scope: { workspaceId: string }; retentionSeconds: number }): Promise<void>;
  gcChangeLog?(event: H3Event, input: { scope: { workspaceId: string }; retentionSeconds: number }): Promise<void>;
}
```

File sketch: `server/storage/gateway/types.ts`
```ts
import type { H3Event } from 'h3';

export interface StorageGatewayAdapter {
  id: string;
  presignUpload(event: H3Event, input: { workspaceId: string; hash: string; mimeType: string; sizeBytes: number }): Promise<{ url: string; expiresAt: number; headers?: Record<string,string>; storageId?: string; method?: string }>;
  presignDownload(event: H3Event, input: { workspaceId: string; hash: string; storageId?: string }): Promise<{ url: string; expiresAt: number; headers?: Record<string,string>; storageId?: string; method?: string }>;
  commit?(event: H3Event, input: unknown): Promise<void>;
}
```

Registries are identical in shape to the `AuthWorkspaceStore` registry: `registerX()`, `getX()`.

---

## 2) Refactor core session provisioning to use `AuthWorkspaceStore`

Target: `server/auth/session.ts`

Current state: provider session is resolved correctly, but mapping to user/workspace is still Convex-hardcoded.

New flow (sketch):
```ts
const providerId = config.auth.provider;
const provider = getAuthProvider(providerId);
const providerSession = await provider.getSession(event);

const storeId = config.sync.provider; // canonical store is the selected sync backend (locked decision)
const store = getAuthWorkspaceStore(storeId);

const { userId } = await store.getOrCreateUser({ ... });
const { workspaceId } = await store.getOrCreateDefaultWorkspace(userId);
const role = await store.getWorkspaceRole({ userId, workspaceId });
```

Preserve exact failure behavior:
- use existing `auth.sessionProvisioningFailure` modes
- keep per-request caching logic intact

---

## 3) Refactor `/api/sync/*` and `/api/storage/*` to dispatch to adapters

Core endpoints keep:
- `resolveSessionContext(event)`
- `requireCan(session, ...)`
- schema validation + rate limiting

Core endpoints must stop importing:
- `convex/*`
- `~~/convex/_generated/*`
- Clerk token helpers

### Example: `server/api/sync/push.post.ts` sketch
```ts
export default defineEventHandler(async (event) => {
  if (!isSsrAuthEnabled(event) || !isSyncEnabled(event)) throw createError({ statusCode: 404 });

  const session = await resolveSessionContext(event);
  requireCan(session, 'workspace.write', { kind: 'workspace', id: body.scope.workspaceId });

  const adapter = getActiveSyncGatewayAdapter(); // based on config.sync.provider
  if (!adapter) throw createError({ statusCode: 500, statusMessage: 'Sync adapter not registered' });

  return await adapter.push(event, body);
});
```

### Example: provider token usage (server)
Whenever you need a provider token, do not call Clerk helpers directly:
```ts
const broker = getProviderTokenBroker(config.auth.provider);
const token = await broker?.getProviderToken(event, { providerId: config.sync.provider, template: 'convex' });
```

---

## 4) Refactor workspace UI to a provider-agnostic `WorkspaceApi`

Target: `app/plugins/workspaces/WorkspaceManager.vue`

Goal: UI must not import provider SDKs. It calls:
- `useWorkspaceApi().list/create/update/remove/setActive()`

Recommended backing:
- Add core SSR endpoints `/api/workspaces/*` that use the configured store adapter (`AuthWorkspaceStore` extended for CRUD, or a new `WorkspaceStore`).

This keeps UI stable and prevents client build-graph coupling.

---

## 5) Provider packages: how they “register plugins” (the correct Nuxt way)

Providers can’t register Nuxt plugins at runtime from app code.
They *can* ship a Nuxt module that adds client/server plugins at build time.

### 5.1 `or3-provider-clerk` (auth provider)

**Nuxt module: `packages/or3-provider-clerk/src/module.ts` (sketch)**
```ts
import { defineNuxtModule, addServerMiddleware, addServerPlugin, addModule } from '@nuxt/kit';
import { resolve } from 'pathe';

export default defineNuxtModule({
  meta: { name: 'or3-provider-clerk' },
  async setup(_opts, nuxt) {
    // Install upstream module
    await addModule('@clerk/nuxt');

    const runtimeDir = resolve(__dirname, './runtime');
    addServerMiddleware({
      path: '/',
      handler: resolve(runtimeDir, 'server/middleware/00.clerk'),
    });
    addServerPlugin(resolve(runtimeDir, 'server/plugins/register'));
  },
});
```

**Server plugin registration: `runtime/server/plugins/register.ts`**
```ts
import { registerAuthProvider } from '~~/server/auth/registry';
import { registerProviderTokenBroker } from '~~/server/auth/token-broker/registry';

import { clerkAuthProvider } from '../auth/clerk-auth-provider';
import { clerkTokenBroker } from '../auth/clerk-token-broker';

export default defineNitroPlugin(() => {
  registerAuthProvider({ id: 'clerk', order: 100, create: () => clerkAuthProvider });
  registerProviderTokenBroker('clerk', () => clerkTokenBroker);
});
```

### 5.2 `or3-provider-convex` (sync/storage/canonical store)

Convex provider must preserve current “direct realtime sync” behavior.

**Nuxt module: `packages/or3-provider-convex/src/module.ts` (sketch)**
```ts
import { defineNuxtModule, addPlugin, addServerPlugin, addModule } from '@nuxt/kit';
import { resolve } from 'pathe';

export default defineNuxtModule({
  meta: { name: 'or3-provider-convex' },
  async setup(_opts, nuxt) {
    await addModule('convex-nuxt');

    const runtimeDir = resolve(__dirname, './runtime');
    addPlugin(resolve(runtimeDir, 'plugins/convex-sync.client'));
    addPlugin(resolve(runtimeDir, 'plugins/convex-auth-bridge.client')); // token -> convex.setAuth
    addServerPlugin(resolve(runtimeDir, 'server/plugins/register'));
  },
});
```

**Client plugin: `runtime/plugins/convex-sync.client.ts` (sketch)**
```ts
import { registerSyncProvider, setActiveSyncProvider } from '~~/app/core/sync/sync-provider-registry';
import { createConvexSyncProvider } from '../sync/convex-sync-provider';
import { useConvexClient } from 'convex-vue';

export default defineNuxtPlugin(() => {
  const cfg = useRuntimeConfig();
  if (!cfg.public.ssrAuthEnabled || cfg.public.sync?.provider !== 'convex') return;

  const client = useConvexClient();
  registerSyncProvider(createConvexSyncProvider(client));
  setActiveSyncProvider('convex');
});
```

**Server plugin: `runtime/server/plugins/register.ts` (sketch)**
```ts
import { registerAuthWorkspaceStore } from '~~/server/auth/store/registry';
import { registerSyncGatewayAdapter } from '~~/server/sync/gateway/registry';
import { registerStorageGatewayAdapter } from '~~/server/storage/gateway/registry';

import { convexAuthWorkspaceStore } from '../store/convex-auth-workspace-store';
import { convexSyncGatewayAdapter } from '../sync/convex-sync-gateway-adapter';
import { convexStorageGatewayAdapter } from '../storage/convex-storage-gateway-adapter';

export default defineNitroPlugin(() => {
  registerAuthWorkspaceStore({ id: 'convex', create: () => convexAuthWorkspaceStore });
  registerSyncGatewayAdapter({ id: 'convex', create: () => convexSyncGatewayAdapter });
  registerStorageGatewayAdapter({ id: 'convex', create: () => convexStorageGatewayAdapter });
});
```

Important:
- Convex provider is also where provider-only type augmentations live (e.g., `ConvexHttpClient.setAdminAuth` typing), not in core.

---

## 6) Install wizard integration (DX)

Wizard responsibilities (minimum):
- Install selected provider packages with Bun (example): `bun add or3-provider-clerk or3-provider-convex`
- Write `.env` / config values (examples):
  - `SSR_AUTH_ENABLED=true`
  - `AUTH_PROVIDER=clerk`
  - `OR3_SYNC_PROVIDER=convex`
  - `NUXT_PUBLIC_STORAGE_PROVIDER=convex` (or whatever)
- Overwrite `or3.providers.generated.ts` to include the selected provider Nuxt modules.
- Trigger `bun install` (if needed) + `bun run build` + restart.

This gives “install once, then it just works” DX without runtime swapping complexity.

---

## 7) Verification checklist (don’t skip)

### 7.1 Behavior parity (default stack)
- Convex direct sync still subscribes realtime (`onUpdate`) and updates live.
- Auth bridge still sets Convex auth token (same behavior as today).
- Notifications still show up (client + server where applicable).
- Admin actions still work (tokens come from `ProviderTokenBroker`).

### 7.2 Decoupling proof (build matrix)
- Remove Clerk deps + select non-Clerk auth ⇒ `bun run build` + `bun run type-check`
- Remove Convex deps + select non-Convex providers ⇒ `bun run build` + `bun run type-check`

