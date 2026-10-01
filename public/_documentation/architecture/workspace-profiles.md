# Workspace profiles and app layout

Use a workspace profile to choose how OR3 presents features that are already
registered: navigation, dashboard items, panes opened for a new layout,
commands, and mobile navigation. Profiles arrange the app; they do not install
plugins, remove workspace data, or grant permissions. Plugin and theme authors
can contribute profiles using stable registry IDs.

Profiles are declarative data. The schema rejects unknown fields and cannot
carry executable code, URLs, styles, or agent instructions.

## Resolution

The pure resolver hides explicit IDs, applies explicit order/groups, reports
unknown IDs, appends unspecified available items, enforces deployment pane
limits, and returns a deeply frozen result. A missing, invalid, or
unsupported-version profile falls back to Standard OR3 with diagnostics.
Initial pane entries use `{ id, recordId? }`, where `id` is a registered pane
app ID.

Core built-ins include Standard OR3, Minimal Chat, and Document Workspace.
The External Agents plugin registers Coding Workspace while installed; removing
that registration makes a saved selection fall back to Standard OR3.

## Selection, themes, and lifecycle

Selection lives in workspace-scoped KV and is independent from theme choice.
Applying a profile preserves workspace data, plugins, and active panes.
Initial panes open once for a new or explicitly reset layout; ordinary reloads
restore the existing panes. Reset selects Standard OR3 without deleting user
data.

Built-in and installed-theme selections use the same serialized projection at
the SSR/client bootstrap boundary. Server selection, resolution, and runtime
state are request-scoped, and the resolved core projection is serialized in
the Nuxt payload.

During SSR, the server resolves the selected ID against built-in profiles and
validated profiles bundled with the active or available themes. It resolves
their referenced navigation, dashboard, pane, and command IDs against the core
item inventory; client plugin items are not in that inventory. A profile
contributed only by a client plugin is also unavailable to the server, so SSR
sends the Standard OR3 projection. After that plugin registers, the client
resolves the saved profile, which can update the layout after hydration.

The [server bootstrap plugin](https://github.com/Saluana/or3-chat/blob/or3-cloud/app/plugins/93.workspace-profiles.server.ts)
resolves built-in profiles and validated profiles it can load from themes. Its
[request test](https://github.com/Saluana/or3-chat/blob/or3-cloud/app/plugins/__tests__/workspace-profile-server.test.ts)
covers request isolation and a theme-provided profile. The
[rendered hydration test](https://github.com/Saluana/or3-chat/blob/or3-cloud/tests/integration/workspace-profile-hydration-render.integration.test.ts)
SSR-renders a Vue probe, hydrates it in a DOM, and checks that serialized
built-in profile markup stays in place without Vue hydration warnings. It does
not boot a built Nuxt server or load a client package.

To verify that boundary in a browser, use a disposable SSR-auth workspace with
External Agents installed and enabled. In the Dashboard's **Workspace Profile**
settings, apply **Coding Workspace**, then hard-reload the workspace. Capture
the response payload and browser console: SSR should resolve to Standard OR3
because Coding Workspace is registered by the client package through the
[External Agents host bridge](https://github.com/Saluana/or3-chat/blob/or3-cloud/app/composables/plugins/external-agent-host-bridge.ts);
after the package registers, the client should restore Coding Workspace. Check
that hydration emits no Vue mismatch warnings and that the profile selector
settles on Coding Workspace. Repeat in another workspace to check the
workspace-scoped selection cookie. This built-Nuxt/browser path remains
unverified.

A theme may bundle validated profiles and recommend one, but
install/activation never applies it; the user must invoke the explicit
recommendation action.

## Versioning and security

The current profile contract requires `schemaVersion: 1`. Incompatible future
shapes need a new schema version and migration. Profiles contain stable IDs,
never components, URLs, callbacks, CSS, bindings, data fetching, workflows, or
agent instructions.

If resolution falls back, inspect diagnostics. Unordered new plugin items are
intentionally appended. Profiles cannot create missing capabilities.
