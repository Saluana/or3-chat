# Workspace Profiles

Workspace Profiles are declarative projections of OR3's existing registries.
They arrange IDs; they do not register executable UI, fetch data, delete user
content, or replace sidebar, dashboard, command, pane, or theme ownership.

## V1 schema

```ts
interface WorkspaceProfileV1 {
  schemaVersion: 1
  id: string
  label: string
  description?: string
  navigation?: {
    defaultPageId?: string
    groups?: Array<{ id: string; label: string; items: string[] }>
    order?: string[]
    hidden?: string[]
  }
  dashboard?: { order?: string[]; hidden?: string[] }
  workspace?: {
    initialPanes?: Array<{ id: string; recordId?: string }>
    desktopPaneLimit?: number
    mobilePolicy?: 'single-pane'
  }
  commands?: { pinned?: string[]; order?: string[]; hidden?: string[] }
  mobile?: { bottomNavigation?: string[]; defaultPageId?: string }
}
```

Zod rejects unknown/executable fields. Profile IDs are unique and owned;
registration returns an idempotent handle that must be disposed during HMR.

## Resolution

One pure resolver receives the selected profile, current registry inventory,
and deployment limits. For every surface it:

1. removes explicitly hidden IDs;
2. applies explicit order/group references;
3. ignores unknown IDs and emits structured diagnostics;
4. appends unspecified available items in canonical order;
5. caps pane settings to deployment limits;
6. returns a deeply frozen result.

Missing, invalid, or unsupported-version selections fall back to `standard-or3`
without crashing. Standard OR3 is a captured parity profile: resolving it must
match current navigation, dashboard, commands, panes, mobile shell, and
defaults. Built-ins also include Minimal Chat and Document Workspace. Coding
Workspace keeps non-agent surfaces usable when External Agents is absent.

## Selection and lifecycle

The selected profile ID is stored in workspace-scoped KV independently from
the active theme. Apply changes the resolved projection but preserves data,
plugins, and already-open panes. Initial panes apply once only to a new
workspace or after an explicit layout reset; ordinary reloads rehydrate the
existing pane state.

Reset selects Standard OR3 and resets layout projection only. It does not erase
chats, documents, projects, plugins, themes, or other workspace data.

Built-in and installed-theme profile selections use the same serialized
projection at the SSR/client bootstrap boundary. On the server, selection,
resolution, and runtime state are request-scoped, and the resolved core
projection is serialized in the Nuxt payload.

The server inventory contains core items only. Profiles registered solely by
client plugins are unavailable during SSR, so SSR falls back to Standard OR3
and the client re-resolves after plugin registration. Optional plugin items are
then resolved against the full client inventory before client-only workspace
surfaces mount.

Automated SSR coverage executes the server plugin with isolated request
containers, serializes the resolved payload, performs a real Vue server render,
and hydrates that markup in the browser DOM environment. The test asserts
identical initial markup, no fallback projection, and no hydration mismatch.
A built-Nuxt manual browser smoke remains part of release verification.

## Theme packaging

A theme package may contain validated profiles and name one as a recommendation.
Installing or activating the theme never applies that profile. The settings UI
must present a separate, explicit recommendation action, and invalid profile
bundles are rejected.

## Versioning and extension

- V1 accepts only `schemaVersion: 1`; future incompatible shapes require a new
  version and explicit migration.
- Reference stable registry IDs, not component imports, URLs, callbacks, CSS,
  bindings, workflows, or agent instructions.
- Omit an item to inherit it automatically; use `hidden` only for intentional
  removal.
- Add resolver tests for unknown IDs, missing plugins, ordering, hiding,
  append behavior, pane limits, fallback, and Standard parity.

## Troubleshooting

- **Profile fell back to Standard:** inspect resolver diagnostics for an
  invalid schema, missing profile, or unsupported version.
- **A plugin item moved to the end:** it was not explicitly ordered and was
  safely appended.
- **A Coding item is absent:** install/enable its owning feature; the profile
  cannot create capabilities.
- **Theme did not rearrange the workspace:** expected. Apply the recommended
  profile explicitly in Workspace Profile settings.

## Non-goals

Profiles are not executable configuration, a plugin SDK, a routing system, a
drag-and-drop layout builder, or a mechanism for deleting or migrating user
data.
