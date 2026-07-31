# Workspace Profiles

Workspace Profiles are safe, declarative projections over existing OR3
registries. V1 may reference navigation, dashboard, pane, command, and mobile
IDs; Zod rejects unknown or executable fields.

## Resolution

The pure resolver hides explicit IDs, applies explicit order/groups, reports
unknown IDs, appends unspecified available items, enforces deployment pane
limits, and returns a deeply frozen result. A missing, invalid, or
unsupported-version profile falls back to Standard OR3 with diagnostics.
Initial pane entries use `{ id, recordId? }`, where `id` is a registered pane
app ID.

Built-ins include Standard OR3, Minimal Chat, Document Workspace, and a Coding
Workspace that degrades safely when External Agents is unavailable.

## Selection, themes, and lifecycle

Selection lives in workspace-scoped KV and is independent from theme choice.
Applying a profile preserves workspace data, plugins, and active panes.
Initial panes run once for a new or explicitly reset layout; normal reloads
rehydrate existing pane state. Reset selects Standard OR3 without deleting user
data.

Built-in and installed-theme selections use the same serialized projection at
the SSR/client bootstrap boundary. Server selection, resolution, and runtime
state are request-scoped, and the resolved core projection is serialized in
the Nuxt payload.

The server inventory contains core items only. Profiles registered solely by
client plugins are unavailable during SSR, so SSR falls back to Standard OR3
and the client re-resolves after plugin registration. Optional plugin items
resolve against the full client inventory before client-only workspace
surfaces mount.

Current SSR tests cover isolated server-plugin requests and serialized initial
client resolution, not browser DOM hydration against a built Nuxt server. That
rendered verification remains open.

A theme may bundle validated profiles and recommend one, but
install/activation never applies it; the user must invoke the explicit
recommendation action.

## Versioning and security

V1 accepts only `schemaVersion: 1`. Incompatible future shapes require a new
version and migration. Profiles contain stable IDs, never components, URLs,
callbacks, CSS, bindings, data fetching, workflows, or agent instructions.

If resolution falls back, inspect diagnostics. Unordered new plugin items are
intentionally appended. Profiles cannot create missing capabilities.

Profiles are not executable configuration, a plugin SDK, a new router, a
drag-and-drop builder, or a data migration/deletion mechanism.
