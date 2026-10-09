# Workspace profiles and app layout

Use a workspace profile to choose how OR3 presents features that are already
registered: navigation, dashboard items, panes opened for a new layout,
commands, and mobile navigation. Profiles arrange the app; they do not install
plugins, remove workspace data, or grant permissions. Plugin and theme authors
can contribute profiles using stable registry IDs.

Profiles are declarative data. The schema rejects unknown fields and cannot
carry executable code, URLs, styles, or agent instructions. Import `WorkspaceProfileV1`
from `app/core/workspace-profiles/schema.ts`; related resolver and inventory types
live in `app/core/workspace-profiles/types.ts`. Registry registration returns an owned,
idempotent disposal handle; clean it up during plugin teardown and HMR.

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
validated profiles in the generated theme metadata. Inactive theme modules
are not loaded just to discover profiles. It resolves
their referenced navigation, dashboard, pane, and command IDs against the core
item inventory; client plugin items are not in that inventory. A profile
contributed only by a client plugin is also unavailable to the server, so SSR
sends the Standard OR3 projection. After that plugin registers, the client
resolves the saved profile, which can update the layout after hydration.

The server bootstrap and rendered hydration tests cover request isolation and
serialized core projections. They do not qualify an authenticated transition
to a client-package profile in a built Nuxt deployment; that browser path
remains unverified. Preserve that distinction when checking hydration.

A theme may bundle validated profiles and recommend one, but
install/activation never applies it; the user must invoke the explicit
recommendation action.

## Versioning and security

The current profile contract requires `schemaVersion: 1`. Incompatible future
shapes need a new schema version and migration. Profiles contain stable IDs,
never components, URLs, callbacks, CSS, bindings, data fetching, workflows, or
agent instructions.

If resolution falls back, inspect diagnostics for a missing profile, invalid
schema, or unsupported version. Unordered new plugin items are intentionally
appended. Missing Coding Workspace requires its owning External Agents package;
profiles cannot create missing capabilities. Theme recommendations require an
explicit apply action.

Standard OR3 is the parity fallback for core navigation, dashboard, commands,
panes, and mobile defaults. Resolver changes should preserve this parity and
cover unknown IDs, ordering, hiding, append behavior, pane limits, and cleanup.
Incompatible schema changes require a new version and explicit migration.
