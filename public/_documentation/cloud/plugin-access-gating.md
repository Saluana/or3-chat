# Plugin Access Gating

Plugin gating controls which plugins, dashboard items, and sidebar surfaces a user can see and interact with. It has two distinct jobs that must both work correctly:

- **Client-side gating** hides UI surfaces the user can’t access. This is a UX concern — it keeps the interface clean and avoids confusion.
- **Server-side enforcement** blocks unauthorized requests at the API level. This is the actual security layer. Client gating can be bypassed; server enforcement cannot be.

If you only gate on the client, a motivated user can hit the server routes directly. If you only gate on the server, authenticated users see a full UI that errors when they interact with it. You need both.

---

## The policy model

Every plugin or page surface can declare an access policy:

```ts
access: {
    authRequired?: boolean          // must be authenticated
    requiredWorkspaceRoles?: ('owner' | 'editor' | 'viewer')[]
    requiredEntitlements?: string[] // e.g. ['paid', 'enterprise']
    mode?: 'all' | 'any'           // default: 'all'
}
```

Policies come from two sources and are merged together:
1. **Plugin defaults** — set in the extension's `or3.manifest.json` or passed to `registerDashboardPlugin(...)` at runtime.
2. **Workspace admin overrides** — stored in `plugins.settings.<pluginId>.access`, allowing admins to tighten or loosen defaults per workspace.

`mergePluginGatePolicy(...)` handles the merge so you never need to manage this manually.

---

## What the gate actually evaluates

`evaluatePluginGate(...)` takes four inputs and returns an `allowed` boolean plus a `reason` string:

- **`session.authenticated`** and **`session.role`** — from the resolved `SessionContext`
- **`entitlements`** — resolved separately per request (can be empty if no resolver is registered)
- **`pluginEnabled`** — whether this plugin is enabled in the workspace's `plugins.enabled` list

The `pluginEnabled` check only applies to **installed extension plugins** (those with a manifest). Built-in IDs like `core:*` bypass this check intentionally — otherwise a misconfigured `plugins.enabled` list could accidentally lock admins out of core functionality.

---

## How client-side gating works

The client uses `getPluginGateDecision(pluginId, policy)` from `app/utils/plugins/access-gate.ts`. The logic is optimistic-first, then authoritative:

1. **Immediate local decision** — computed from the cached session context. This renders instantly without a network round-trip, so the UI doesn't flicker on load.
2. **Server decision fetch** (when `SSR_AUTH_ENABLED=true`) — `GET /api/plugins/access?pluginId=...` is called asynchronously and its result replaces the local one.
3. **Conservative merge** — `allowed` only if *both* the local and server decisions allow it. If the server says no, the local yes is overridden.

Decisions are cached per plugin, keyed on `authenticated|userId|workspaceId|role`. When any of those change (e.g., workspace switch or sign-in), the entire decision cache is invalidated automatically.

This gating runs for every registered dashboard plugin, sidebar page, section, and action.

---

## How server-side enforcement works

Call `checkPluginAccess(event, { pluginId })` or `requirePluginAccess(event, { pluginId })` from `server/utils/plugins/access/require-plugin-access.ts` at the top of any protected server route.

Internally it does:

1. Resolve the session (cached within the request, so this is cheap if already called).
2. Look up the plugin's manifest defaults if it's an installed extension.
3. Load workspace plugin settings and merge any admin access override.
4. Resolve entitlements for this request.
5. Call `evaluatePluginGate(...)` with all of the above.
6. On deny: throw `401` for unauthenticated requests, `403` for everything else.

`requirePluginAccess` throws on deny. `checkPluginAccess` returns the result and lets you handle it yourself.

---

## Avoiding auth flicker in the dashboard

If you render the dashboard plugin grid before the session is resolved, plugins that require auth will briefly appear then disappear as the access check resolves. To avoid this:

- Give all dashboard items (including built-in/core ones) an explicit `access` policy so the gate has something to evaluate immediately.
- When `SSR_AUTH_ENABLED=true` and the session is still loading, defer rendering the plugin grid rather than showing a partially gated view.
- The server decision from `/api/plugins/access` is the ground truth — the local decision is just a fast first render.

---

## Example

```ts
registerDashboardPlugin({
    id: 'workspaces',
    icon: 'pixelarticons:users',
    label: 'Workspaces',
    access: {
        authRequired: true,
        requiredWorkspaceRoles: ['owner', 'editor'],
    },
});
```

A `viewer` will not see this item in the dashboard, and even if they navigate directly to the plugin's route, the server gate will return 403.

---

## Troubleshooting

**Plugin visible when it shouldn't be, or missing when it should be visible:**
- Check `/api/plugins/access?pluginId=<id>` — the response includes `allowed`, `reasons`, and `effectivePolicy` so you can see exactly what the server evaluated.
- Check `/api/auth/session` to confirm you have the expected `role` and workspace in scope.

**Plugin always denied with `plugin-disabled`:**
- This only applies to installed extensions. Check that `plugins.enabled` for this workspace contains the plugin ID.
- Built-in (`core:*`) plugins should never hit this — if they do, the ID is being misidentified as an extension.

**Admin override not taking effect:**
- Verify the shape of `plugins.settings.<id>.access` in workspace settings. A malformed override silently falls back to plugin defaults.

**Plugin ID instability (works once, breaks on reload):**
- Plugin IDs must be stable and identical in both the manifest (`or3.manifest.json`) and the runtime registration. A mismatch means the manifest defaults are never found, so decisions are based on zero policy context.

## Related

- [Identity, Workspaces, Roles, and Entitlements](./identity-access-concepts)
- [Authentication System](./auth-system)
- [Cloud Providers](./providers)
- [Troubleshooting OR3 Cloud](./troubleshooting)
- [useDashboardPlugins](../composables/useDashboardPlugins)
