# Code Review: MAIN APP Workspace Loading/Switching Issues

**Branch:** `admin-dashboard`  
**Review Date:** 2026-01-30  
**Reviewer:** Stack Overflow Elite Engineer Neckbeard  
**Context:** User reports wrong workspace loading and switching not working in MAIN APP (not admin)

---

## Issue 1: HTTP Cache Catastrophe - Session API Cached for 60 Seconds

**File:** `server/api/auth/session.get.ts`  
**Lines:** 42-49

```typescript
// Set cache headers to reduce server load
if (session.authenticated) {
    // Cache authenticated sessions for 60s
    setResponseHeader(event, 'Cache-Control', 'private, max-age=60');
} else {
    // Don't cache unauthenticated responses
    setResponseHeader(event, 'Cache-Control', 'no-store');
}
```

**File:** `app/composables/auth/useSessionContext.ts`  
**Lines:** 31

```typescript
const fetchPromise = $fetch<SessionPayload>('/api/auth/session');
```

**Why this is bad:**
You've set a 60-second HTTP cache on the session endpoint. When a user switches workspaces:

1. User clicks "Select" on Workspace B in `WorkspaceManager.vue`
2. `setActiveWorkspaceMutation.mutate()` updates `active_workspace_id` in Convex
3. `reloadNuxtApp({ ttl: 500 })` reloads the page
4. `00-workspace-db.client.ts` plugin runs and calls `useSessionContext().refresh()`
5. `refresh()` calls `$fetch('/api/auth/session')`
6. Browser says: "I cached this 30 seconds ago with max-age=60, I'll use that"
7. Browser returns OLD session with Workspace A
8. User sees Workspace A content despite just switching to Workspace B
9. User reports: "it says it switched, but the content loaded is the same"

The 60-second cache makes workspace switching appear broken because the browser returns stale session data.

**Real-world consequences:**
- Workspace switching appears completely broken to users
- Users see wrong workspace data after switching
- Support tickets complaining that "workspace switch doesn't work"
- Users lose trust in the app

**Fix:**
Never cache session responses:

```typescript
// server/api/auth/session.get.ts
export default defineEventHandler(async (event) => {
    // ... existing code ...
    
    const session = await resolveSessionContext(event);
    
    // NEVER cache session - it includes workspace info that changes
    setResponseHeader(event, 'Cache-Control', 'no-store, max-age=0');
    
    return {
        session: session.authenticated ? session : null,
    };
});
```

**Validity:** ✅ **Valid.** This was a real bug. Session responses must be `no-store` or workspace switches will hydrate with stale workspace IDs.

---

## Issue 2: SSR useState Persistence Shows Stale Workspace

**File:** `app/composables/auth/useSessionContext.ts`  
**Lines:** 52-69

```typescript
if (import.meta.server) {
    const asyncData = useFetch<SessionPayload>('/api/auth/session', {
        key: 'auth-session',
        dedupe: 'defer',
    });

    watchEffect(() => {
        if (asyncData.data.value) {
            state.value = asyncData.data.value;
        }
    });

    return {
        data: computed(() => asyncData.data.value ?? state.value),
        pending: asyncData.pending,
        error: asyncData.error,
        refresh: asyncData.refresh,
    };
}
```

**Why this is bad:**
On SSR, `useState('auth-session')` is serialized and sent to the client as part of the HTML payload. When the page reloads after a workspace switch, Nuxt might serve a cached SSR page with the OLD session data. The client hydrates with this stale data, showing the wrong workspace before the client-side refresh kicks in.

This creates a "flash of wrong content" that confuses users.

**Real-world consequences:**
- Wrong workspace shown immediately after page load
- Hydration mismatches between server and client
- Flash of wrong content before client corrects it
- User thinks they're in the wrong workspace

**Fix:**
Skip SSR for session and always fetch client-side after workspace operations:

```typescript
// app/composables/auth/useSessionContext.ts
export function useSessionContext() {
    const state = useState<SessionPayload | null>('auth-session', () => null);
    
    // Skip SSR - always fetch client-side to avoid stale data
    if (import.meta.server) {
        return {
            data: computed(() => null),
            pending: computed(() => true),
            error: computed(() => null),
            refresh: async () => null,
        };
    }
    
    // Client-side only
    const refresh = async () => {
        // Add cache-busting to bypass HTTP cache
        const timestamp = Date.now();
        const fetchPromise = $fetch<SessionPayload>(`/api/auth/session?_=${timestamp}`);
        // ... rest of refresh logic
    };
    
    // Auto-refresh on mount
    onMounted(() => {
        void refresh();
    });
    
    // ...
}
```

**Validity:** ⚠️ **Partially valid.** SSR state can cause a brief flash of stale workspace if the session endpoint or SSR payload is cached. However, the primary bug was HTTP caching. Disabling SSR entirely is heavy-handed; better to keep SSR but ensure `no-store` + client refresh after switching.

---

## Issue 3: No Cache Busting After Workspace Switch

**File:** `app/plugins/workspaces/WorkspaceManager.vue`  
**Lines:** 471-485

```typescript
async function selectWorkspace(workspace: WorkspaceSummary) {
    if (workspace.is_active) return;
    selecting.value = true;
    try {
        await setActiveWorkspaceMutation.mutate({ workspace_id: workspace._id });
        // Update cache before reload
        cachedActiveId.value = workspace._id;
        cachedWorkspaces.value = cachedWorkspaces.value.map((item) => ({
            ...item,
            is_active: item._id === workspace._id,
        }));
        await saveCache(cachedWorkspaces.value);
        toast.add({ title: 'Workspace updated', description: 'Switching workspace...' });
        // Full reload ensures clean Dexie DB binding and sync engine restart
        reloadNuxtApp({ ttl: 500 });
    } catch (error) {
        // ...
    }
}
```

**Why this is bad:**
When `reloadNuxtApp` is called after switching workspaces, the browser might still use cached resources including the session API response. There's no mechanism to force a fresh fetch of the session data after the workspace change.

**Real-world consequences:**
- Browser serves cached session with old workspace
- User sees wrong workspace content after reload
- Reload doesn't actually refresh the workspace context
- Switch appears to fail

**Fix:**
Clear caches and add cache-busting before reload:

```typescript
// app/plugins/workspaces/WorkspaceManager.vue
async function selectWorkspace(workspace: WorkspaceSummary) {
    if (workspace.is_active) return;
    selecting.value = true;
    try {
        await setActiveWorkspaceMutation.mutate({ workspace_id: workspace._id });
        
        // Clear all session-related caches before reload
        if (import.meta.client) {
            // Clear Nuxt payload cache
            const nuxtApp = useNuxtApp();
            delete nuxtApp.payload.data['auth-session'];
            
            // Clear useState
            const sessionState = useState('auth-session');
            sessionState.value = null;
            
            // Add cache-busting query param
            const url = new URL(window.location.href);
            url.searchParams.set('ws', Date.now().toString());
            window.history.replaceState({}, '', url);
        }
        
        toast.add({ title: 'Workspace updated', description: 'Switching workspace...' });
        reloadNuxtApp({ ttl: 500 });
    } catch (error) {
        // ... error handling ...
    } finally {
        selecting.value = false;
    }
}
```

**Validity:** ⚠️ **Mostly superseded.** Cache-busting was needed because the endpoint was cacheable. Now that `/api/auth/session` is `no-store` and client fetch uses `cache: 'no-store'`, this is no longer necessary. The remaining requirement is to refresh session before reload (already implemented).

---

## Issue 4: Double Session Watchers Create Race Condition

**File:** `app/plugins/00-workspace-db.client.ts`  
**Lines:** 18-46

```typescript
const { data, refresh } = useSessionContext();
// ...
await refresh();
// ...
setActiveWorkspaceDb(resolveWorkspaceId());

watch(
    () => data.value?.session,
    async (newSession, oldSession) => {
        const oldWorkspaceId = oldSession?.workspace?.id;
        if (oldWorkspaceId) {
            cleanupCursorManager(dbName);
            cleanupHookBridge(dbName);
            cleanupSubscriptionManager(`${oldWorkspaceId}:default`);
        }
        setActiveWorkspaceDb(resolveWorkspaceId());
    }
);
```

**File:** `app/plugins/convex-sync.client.ts`  
**Lines:** 234-288

```typescript
const { data: sessionData } = useSessionContext();
// ...
watch(
    () => sessionData.value?.session,
    (session) => updateSyncForRouteAndSession(session, currentPath),
    { immediate: true }
);

function updateSyncForRouteAndSession(session: unknown, path: string): void {
    // ...
    setActiveWorkspaceDb(workspaceId);
    if (workspaceId) {
        void startSyncEngine(workspaceId).catch((error) => {
            console.error('[convex-sync] Failed to start sync engine:', error);
        });
    }
}
```

**Why this is bad:**
Two plugins are watching the same session data and both calling `setActiveWorkspaceDb()`. The execution order depends on plugin registration order:

1. `00-workspace-db.client.ts` (runs first due to "00-" prefix)
2. `convex-sync.client.ts` (runs later)

On page load after workspace switch:
1. 00-workspace-db refreshes session and sets workspace to Workspace B
2. Browser cache returns OLD session (Issue #1) -> sets workspace to Workspace A
3. convex-sync starts watching and sets workspace again based on stale session
4. Both plugins disagree on which workspace is active
5. User sees inconsistent state

**Real-world consequences:**
- Intermittent workspace switching failures
- Wrong workspace loaded on page start
- Race conditions in database initialization
- Sync engine started for wrong workspace
- Complete workspace switching chaos

**Fix:**
Consolidate workspace management into a single composable:

```typescript
// app/composables/useWorkspaceManager.ts
let workspaceChangeInProgress = false;

export function useWorkspaceManager() {
    const { data: sessionData, refresh } = useSessionContext();
    const activeWorkspaceId = computed(() => 
        sessionData.value?.session?.workspace?.id ?? null
    );
    
    // Single watcher for workspace changes
    watch(activeWorkspaceId, async (newId, oldId) => {
        if (workspaceChangeInProgress) return;
        if (newId === oldId) return;
        
        workspaceChangeInProgress = true;
        try {
            // Stop sync for old workspace
            if (oldId) {
                await stopSyncEngine();
                cleanupWorkspaceResources(oldId);
            }
            
            // Set new workspace DB
            setActiveWorkspaceDb(newId);
            
            // Start sync for new workspace
            if (newId) {
                await startSyncEngine(newId);
            }
        } finally {
            workspaceChangeInProgress = false;
        }
    }, { immediate: true });
    
    // Force refresh function for workspace switch
    const forceWorkspaceRefresh = async () => {
        await refresh();
    };
    
    return { activeWorkspaceId, forceWorkspaceRefresh };
}

// Use in both plugins:
// app/plugins/00-workspace-init.client.ts
export default defineNuxtPlugin(async () => {
    const { forceWorkspaceRefresh } = useWorkspaceManager();
    await forceWorkspaceRefresh();
});
```

**Validity:** ✅ **Valid.** Multiple plugins mutating active workspace is a real race footgun. This isn’t the main cause of the reported issue, but it’s a legitimate architectural problem that can cause hard-to-reproduce bugs.

---

## Issue 5: resolveSession Falls Back to First Membership Without User Consent

**File:** `convex/workspaces.ts`  
**Lines:** 413-460 (resolveSession query)

```typescript
export const resolveSession = query({
    args: {
        provider: v.string(),
        provider_user_id: v.string(),
    },
    handler: async (ctx, args) => {
        // ... lookup user ...
        
        let workspaceId = user?.active_workspace_id ?? undefined;

        if (workspaceId) {
            // Check if user is still a member of active workspace
            const activeMembership = await ctx.db
                .query('workspace_members')
                .withIndex('by_workspace_user', (q) =>
                    q.eq('workspace_id', activeWorkspaceId).eq('user_id', userId)
                )
                .first();
            if (!activeMembership) {
                workspaceId = undefined; // User was removed from workspace
            }
        }

        if (!workspaceId) {
            // FALLBACK: Use first membership (oldest workspace)
            const firstMembership = await ctx.db
                .query('workspace_members')
                .withIndex('by_user', (q) => q.eq('user_id', userId))
                .order('asc')
                .first();
                
            if (firstMembership) {
                workspaceId = firstMembership.workspace_id;
            }
        }
        // ...
    },
});
```

**Why this is bad:**
If a user's `active_workspace_id` is null or they were removed from their active workspace, the system automatically falls back to their "first" workspace (oldest membership). This happens WITHOUT any explicit user action and can be confusing.

Scenarios where this causes problems:
1. User was removed from Workspace A, suddenly sees Workspace B on next load
2. Race condition: `setActive` mutation hasn't propagated yet, system falls back to old workspace
3. Database inconsistency: `active_workspace_id` temporarily null, user sees wrong workspace

**Real-world consequences:**
- User suddenly sees different workspace without switching
- Data appears to "disappear" (it's in the other workspace)
- User panic: "where did my threads go?!"
- Wrong workspace loaded without user consent

**Fix:**
Don't auto-fallback. Return null and let the UI handle it:

```typescript
export const resolveSession = query({
    args: {
        provider: v.string(),
        provider_user_id: v.string(),
    },
    handler: async (ctx, args) => {
        // ... lookup user ...
        
        const workspaceId = user?.active_workspace_id ?? undefined;
        
        if (workspaceId) {
            // Verify membership
            const membership = await ctx.db
                .query('workspace_members')
                .withIndex('by_workspace_user', (q) =>
                    q.eq('workspace_id', workspaceId).eq('user_id', userId)
                )
                .first();
                
            if (membership) {
                // Return the explicitly selected workspace
                const workspace = await ctx.db.get(workspaceId);
                return {
                    id: workspaceId,
                    name: workspace?.name ?? 'Workspace',
                    role: membership.role,
                };
            }
        }
        
        // No active workspace or not a member - return null
        // Let the UI prompt user to select a workspace
        return null;
    },
});
```

Then in `server/auth/session.ts`:

```typescript
const resolved = await convex.query(api.workspaces.resolveSession, {
    provider: providerSession.provider,
    provider_user_id: providerSession.user.id,
});

if (!resolved) {
    // User has no active workspace - require workspace selection
    return {
        authenticated: true,
        provider: providerSession.provider,
        providerUserId: providerSession.user.id,
        user: { /* ... */ },
        workspace: null, // Explicitly null
        role: null,
        requiresWorkspaceSelection: true, // Flag for UI
    };
}
```

**Validity:** ✅ **Valid.** Silent fallback can put users into unexpected workspaces. It’s a product decision but contributes to “wrong workspace” reports. If you keep it, you need explicit UX to explain the fallback.

---

## Summary: Why Workspaces Load Wrong

The user-reported issues ("loads wrong workspace", "says it switched but content is same") are caused by:

1. **60-second HTTP cache** on session API - Browser returns stale data after switch
2. **SSR hydration** with stale session state - Wrong workspace shown initially
3. **No cache busting** - Reload uses cached session with old workspace
4. **Double watchers** - Race condition between plugins setting different workspaces
5. **Auto-fallback** - System silently changes workspace without user consent

**Priority fixes:**
1. **CRITICAL**: Remove `max-age=60` from session API, use `no-store`
2. **HIGH**: Add cache-busting query param to session fetch
3. **HIGH**: Consolidate workspace watchers into single composable
4. **MEDIUM**: Skip SSR for session, fetch client-side only
5. **LOW**: Remove auto-fallback, require explicit workspace selection

**Validity:** ⚠️ **Mixed.** The summary correctly identifies caching as critical. The SSR/payload and cache-busting points are secondary once caching is fixed. The double-watcher and fallback issues are real but not necessarily the primary “wrong workspace on switch” symptom.


## Issue 6: HTTP Cache Catastrophe - Session API Cached for 60 Seconds
**File:** `server/api/auth/session.get.ts`  
**Lines:** 42-49
```typescript
// Set cache headers to reduce server load
if (session.authenticated) {
    // Cache authenticated sessions for 60s
    setResponseHeader(event, 'Cache-Control', 'private, max-age=60');
} else {
    // Don't cache unauthenticated responses
    setResponseHeader(event, 'Cache-Control', 'no-store');
}
```
**File:** `app/composables/auth/useSessionContext.ts`  
**Lines:** 31
```typescript
const fetchPromise = $fetch<SessionPayload>('/api/auth/session');
```
**Why this is bad:**
You've set a 60-second HTTP cache on the session endpoint. When a user switches workspaces:
1. User clicks "Select" on Workspace B in `WorkspaceManager.vue`
2. `setActiveWorkspaceMutation.mutate()` updates `active_workspace_id` in Convex
3. `reloadNuxtApp({ ttl: 500 })` reloads the page
4. `00-workspace-db.client.ts` plugin runs and calls `useSessionContext().refresh()`
5. `refresh()` calls `$fetch('/api/auth/session')`
6. Browser says: "I cached this 30 seconds ago with max-age=60, I'll use that"
7. Browser returns OLD session with Workspace A
8. User sees Workspace A content despite just switching to Workspace B
9. User reports: "it says it switched, but the content loaded is the same"
The 60-second cache makes workspace switching appear broken because the browser returns stale session data.
**Real-world consequences:**
- Workspace switching appears completely broken to users
- Users see wrong workspace data after switching
- Support tickets complaining that "workspace switch doesn't work"
- Users lose trust in the app
**Fix:**
Never cache session responses, or use a very short cache time:
```typescript
// Option 1: No caching at all (safest)
setResponseHeader(event, 'Cache-Control', 'no-store, max-age=0');
// Option 2: Very short cache for performance (3 seconds)
setResponseHeader(event, 'Cache-Control', 'private, max-age=3');
// Option 3: Use ETag-based conditional caching
const etag = `W/"${session.workspace.id}-${session.expiresAt}"`;
setResponseHeader(event, 'ETag', etag);
setResponseHeader(event, 'Cache-Control', 'private, no-cache');
```

**Validity:** ❌ **Duplicate of Issue 1.** Same root cause, same fix. Keep one.
---
## Issue 7: SSR useState Persistence Across Reloads
**File:** `app/composables/auth/useSessionContext.ts`  
**Lines:** 52-69
```typescript
if (import.meta.server) {
    const asyncData = useFetch<SessionPayload>('/api/auth/session', {
        key: 'auth-session',
        dedupe: 'defer',
    });
    watchEffect(() => {
        if (asyncData.data.value) {
            state.value = asyncData.data.value;
        }
    });
    return {
        data: computed(() => asyncData.data.value ?? state.value),
        pending: asyncData.pending,
        error: asyncData.error,
        refresh: asyncData.refresh,
    };
}
```
**Why this is bad:**
On SSR, `useState('auth-session')` is serialized and sent to the client. When the page reloads after workspace switch, Nuxt's SSR might serve a cached page with the OLD session data from the previous request. This gets hydrated into the client, showing the wrong workspace initially.
**Real-world consequences:**
- Wrong workspace shown immediately after page load
- Hydration mismatches between server and client
- Flash of wrong content before client corrects it
**Fix:**
Don't use SSR for session state when workspaces can change:
```typescript
export function useSessionContext() {
    const state = useState<SessionPayload | null>('auth-session', () => null);
    
    // Skip SSR entirely for session - always fetch client-side
    if (import.meta.server) {
        return {
            data: computed(() => null),
            pending: computed(() => true),
            error: computed(() => null),
            refresh: async () => null,
        };
    }
    
    // Client-side only
    const refresh = async () => {
        // ... existing refresh logic
        // Add cache-busting query param
        const fetchPromise = $fetch<SessionPayload>(`/api/auth/session?_=${Date.now()}`);
        // ...
    };
    
    // Auto-refresh on mount
    onMounted(() => {
        void refresh();
    });
    
    // ...
}
```

**Validity:** ⚠️ **Partially valid, same as Issue 2.** The caching fix addresses most of this; full SSR disable isn’t required.
---
## Issue 8: No Cache Busting on Workspace Switch
**File:** `app/plugins/workspaces/WorkspaceManager.vue`  
**Lines:** 471-485
```typescript
async function selectWorkspace(workspace: WorkspaceSummary) {
    if (workspace.is_active) return;
    selecting.value = true;
    try {
        await setActiveWorkspaceMutation.mutate({ workspace_id: workspace._id });
        // Update cache before reload
        cachedActiveId.value = workspace._id;
        cachedWorkspaces.value = cachedWorkspaces.value.map((item) => ({
            ...item,
            is_active: item._id === workspace._id,
        }));
        await saveCache(cachedWorkspaces.value);
        toast.add({ title: 'Workspace updated', description: 'Switching workspace...' });
        // Full reload ensures clean Dexie DB binding and sync engine restart
        reloadNuxtApp({ ttl: 500 });
    } catch (error) {
        // ...
    }
}
```
**Why this is bad:**
When reloading after workspace switch, there's no mechanism to bust the HTTP cache for the session API. The browser might use a cached response from before the switch.
**Real-world consequences:**
- Browser serves cached session with old workspace
- User sees wrong workspace content
- Reload doesn't actually "reload" the workspace context
**Fix:**
Add cache-busting query parameter or clear browser cache:
```typescript
async function selectWorkspace(workspace: WorkspaceSummary) {
    // ... existing mutation code ...
    
    // Clear session cache before reload
    if (import.meta.client) {
        // Clear any cached session data
        const nuxtApp = useNuxtApp();
        nuxtApp.payload.data['auth-session'] = null;
        
        // Add cache-busting parameter to URL
        const url = new URL(window.location.href);
        url.searchParams.set('workspace_refresh', Date.now().toString());
        window.history.replaceState({}, '', url.toString());
    }
    
    reloadNuxtApp({ ttl: 500 });
}
```
Then in the session API, strip this parameter:
```typescript
// server/api/auth/session.get.ts
export default defineEventHandler(async (event) => {
    // Strip cache-busting params from URL for cleaner logs
    const url = getRequestURL(event);
    if (url.searchParams.has('workspace_refresh')) {
        url.searchParams.delete('workspace_refresh');
        // Redirect to clean URL (optional)
    }
    
    // ... rest of handler
});
```

**Validity:** ❌ **Redundant after fixing cache headers.** Cache-busting isn’t needed when the response is `no-store` and client fetch uses `cache: 'no-store'`.
---
## Issue 9: Double Session Watchers Race Condition
**File:** `app/plugins/00-workspace-db.client.ts`  
**Lines:** 18-46
```typescript
const { data, refresh } = useSessionContext();
// ...
await refresh();
// ...
setActiveWorkspaceDb(resolveWorkspaceId());
watch(
    () => data.value?.session,
    async (newSession, oldSession) => {
        // ... cleanup old workspace
        setActiveWorkspaceDb(resolveWorkspaceId());
    }
);
```
**File:** `app/plugins/convex-sync.client.ts`  
**Lines:** 234-288
```typescript
const { data: sessionData } = useSessionContext();
// ...
watch(
    () => sessionData.value?.session,
    (session) => updateSyncForRouteAndSession(session, currentPath),
    { immediate: true }
);
function updateSyncForRouteAndSession(session: unknown, path: string): void {
    // ...
    setActiveWorkspaceDb(workspaceId);
    if (workspaceId) {
        void startSyncEngine(workspaceId).catch((error) => {
            console.error('[convex-sync] Failed to start sync engine:', error);
        });
    }
    // ...
}
```
**Why this is bad:**
Two plugins are watching the same session data and both calling `setActiveWorkspaceDb()`. The execution order depends on plugin registration order:
1. `00-workspace-db.client.ts` (runs first due to "00-" prefix)
2. `convex-sync.client.ts` (runs later)
On page load:
1. 00-workspace-db refreshes session and sets workspace
2. convex-sync starts watching and sets workspace again
3. convex-sync also starts sync engine
If the session data changes (e.g., from SSR hydration), both watchers fire again, potentially causing:
- Double workspace switches
- Sync engine restart loops
- Race conditions in Dexie DB initialization
**Real-world consequences:**
- Intermittent workspace switching failures
- Sync engine stuck in restart loops
- Database corruption or initialization errors
- Performance issues from redundant operations
**Fix:**
Consolidate workspace management into a single source of truth:
```typescript
// app/composables/useWorkspaceManager.ts
let workspaceChangeInProgress = false;
export function useWorkspaceManager() {
    const { data: sessionData } = useSessionContext();
    const activeWorkspaceId = computed(() => 
        sessionData.value?.session?.workspace?.id ?? null
    );
    
    watch(activeWorkspaceId, async (newId, oldId) => {
        if (workspaceChangeInProgress) return;
        if (newId === oldId) return;
        
        workspaceChangeInProgress = true;
        try {
            // Stop sync for old workspace
            if (oldId) {
                await stopSyncEngine();
                cleanupWorkspace(oldId);
            }
            
            // Set new workspace DB
            setActiveWorkspaceDb(newId);
            
            // Start sync for new workspace
            if (newId) {
                await startSyncEngine(newId);
            }
        } finally {
            workspaceChangeInProgress = false;
        }
    }, { immediate: true });
    
    return { activeWorkspaceId };
}
// Then in plugins, just use the manager:
// app/plugins/00-workspace-init.client.ts
export default defineNuxtPlugin(() => {
    useWorkspaceManager(); // Just initialize it
});
```

**Validity:** ✅ **Valid.** This is the same architectural problem as Issue 4; keep one.

---

# Task list

- [x] Set `/api/auth/session` to `Cache-Control: no-store`.
- [x] Force client session fetches to bypass caches (`cache: 'no-store'`).
- [x] Refresh session until it reflects the selected workspace before reload.

- [ ] Consolidate active workspace DB ownership into a single plugin/composable (remove double-watcher race).
- [ ] Decide policy for workspace fallback in `resolveSession` (keep with explicit UX or remove).
- [ ] If keeping SSR session hydration, ensure SSR payloads for session cannot be cached; otherwise consider minimizing SSR usage for session display to avoid flashes.
- [ ] Remove duplicated issues from this document (Issue 6/9) to avoid confusion.
---
## Summary: Root Causes of "Wrong Workspace Loading" Issues
The user-reported issues stem from:
1. **60-second HTTP cache** on session API prevents seeing workspace changes immediately
2. **SSR state persistence** might serve old workspace data on reload
3. **No cache busting** when switching workspaces
4. **Double watchers** create race conditions between plugins
5. **Browser caching** without cache-control awareness
**Immediate fixes needed:**
1. Remove `max-age=60` from session API, use `no-store`
2. Add cache-busting query parameter on workspace switch
3. Consolidate workspace watchers into single composable
4. Clear useState on workspace switch before reload
EOF
# Brutal Read: Admin Dashboard Merge Review
zsh:347: unmatched '
Thinking: There's an issue with the command escaping. Let me use a different approach to write the file.
# Wrote dumb-issues2.md
# Code Review: MAIN APP Workspace Loading/Switching Issues
**Branch:** `admin-dashboard`  
**Review Date:** 2026-01-30  
**Reviewer:** Stack Overflow Elite Engineer Neckbeard  
