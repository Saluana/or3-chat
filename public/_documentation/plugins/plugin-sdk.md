# SDK reference

`@or3/plugin-sdk` is the authoring package for installable workspace plugins.
Start with [Build your first plugin](/documentation/plugins/first-plugin) for a running example.
This page describes methods supported by the current host, their permissions,
and how to handle results.

## Define and activate

`defineOr3Plugin({ manifest, setup })` defines a package. Trusted-host entries
export that definition; the reviewed host supplies `setup(context)`. Portable
entries wrap it with `createPortablePlugin(definition)`, which waits for the
host's bootstrap and supplies a mediated `PortablePluginContext`.

```js
import { createPortablePlugin, defineOr3Plugin, definePortableUi, ui } from '@or3/plugin-sdk';
// manifest is your complete exported package manifest.
export default createPortablePlugin(defineOr3Plugin({
    manifest,
    setup(context) {
        context.render(definePortableUi({ nodes: [ui.text('Hello')] }));
    },
}));
```

Identity, workspace, generation, features, and grants come from the host.
Do not construct a production context or set identity on outbound requests.
`context.features.has(id)` checks a feature; `require(id)` throws if it is missing.
`context.signal` ends with the activation. Use `onCleanup()` for listeners and
registration handles. The host removes portable contributions on termination;
worker cleanup callbacks cannot be assumed to run after abrupt termination.

## Supported operations

Permissions listed here still require workspace approval and runtime eligibility.
A namespace in the SDK type definitions does not prove the operation is supported.

| Operation | Required permission | Portable | Trusted host |
| --- | --- | --- | --- |
| `settings.get(key)`, `list()` | `settings.read` | Yes | Yes |
| `settings.set(key, value)`, `delete(key)` | `settings.write` | Yes | Yes |
| `storage.get(key)`, `getRecord(key)`, `list(prefix?)`, `listPage(options?)` | `storage.read` | Yes | Yes |
| `storage.set(key, value, options?)`, `delete(key)` | `storage.write` | Yes | Yes |
| `render(view)`, `onRequest(method, handler)` | Live portable activation; downstream actions enforce their own grants | Yes | Use Vue/host registrations |
| Dashboard `contributions.register()` with `ui.dashboard.card` | `ui.dashboard.register` | Host-rendered view only | Use a qualified host surface |
| `ui.registerSidebar()`, `ui.registerPane()` | `ui.sidebar.register` / `ui.pane.register` | No generic adapter; host registers portable surfaces automatically | Yes |
| `workspace.id`, `workspace.onChange(listener)` | `workspace.read` for the listener | Yes | Yes |
| `panes.open(input)` | `panes.open` | No generic adapter | Yes |
| `commands.register(definition, handler)` | `commands.register` | No generic adapter | Yes |
| Post-source contribution | `ui.command-palette.register` | Not via `createPortablePlugin().contributions` | Yes |
| Chat tools via `runtime.tools` / `runtime.tool` | `tools.register.client` | Yes | Use the package's qualified tool surface |
| `ai.models()`, `ai.complete({ model, prompt, maxOutputTokens? })` | `network.http` on this host | Yes, governed calls | Not a general trusted-host AI adapter |
| `hooks.onAction()` / `onFilter()` | `hooks.register` | No | Yes |
| `activity.registerSource()` | `activity.register` | No | Yes |
| Chat renderer / editor contribution | `chat.message.renderer` / `chat.editor.extension` | No Vue objects | Yes |
| Secret, file, HTTP, and SSE clients | Corresponding `secrets.*`, `files.*`, `network.http`, `network.stream` | Use connection/host action protocols | Qualified trusted adapters |

The current host does not qualify general `chat.create`, `chat.read`,
`chat.message.write`, `workspace.switch`, workspace connection management,
`events.register`, `commands.run.public`, or generic UI toast/confirm/progress
registrations. Portable approved document writes and chat handoffs use host
UI actions rather than those generic methods. The standalone `ai.models` and
`ai.complete` grant names are also unqualified; portable AI uses `network.http`.
An unqualified requested grant blocks review instead of enabling a typed method.

The qualification registry is maintained in
`server/admin/plugins/v2-host-capabilities.ts`. Host-specific integrations in
first-party trusted packages do not establish public support for other packages.

## Results and refusals

Asynchronous SDK methods return a result:

```ts
type Result<T> =
    | { ok: true; value: T }
    | { ok: false; error: { code: string; message: string; retryable: boolean } };
```

```js
const saved = await context.settings.set('greeting', 'Hello');
if (!saved.ok) {
    context.logger.warn(saved.error.message, { code: saved.error.code });
    return;
}
```

Use `pluginOk(value)` and `pluginError(code, message)` for your own SDK handlers.
Synchronous registrations return a handle with `dispose()` and throw on refusal;
wrap optional registrations in `try/catch`. Unsupported default adapters throw
an error with code `unsupported`; unsupported asynchronous methods return that
code in their result. Namespace presence is not a capability check.

The lower-level `PortableClient.call()` has a wire result of
`{ ok: true, result }` or `{ ok: false, code, message }`. Do not confuse it with
SDK `value`/`error`. SDK wrappers map transport refusal codes to SDK error codes;
for example `grant-denied` becomes `permission-denied` and `budget-exceeded`
becomes `quota-exceeded`. Preserve actionable errors in the UI. Never
automatically retry an uncertain paid call or external write.

## Settings

```ts
get(key): Promise<Result<JsonValue | null>>
list(): Promise<Result<Record<string, JsonValue>>>
set(key, value): Promise<Result<void>>
delete(key): Promise<Result<void>>
```

Values are JSON and scoped to the plugin's workspace configuration. Setup saves
validate against declared fields/schema. Required values must be supplied before
readiness; optional fields remain configurable. User-scoped setup fields are
currently refused. Secret fields do not belong in ordinary settings.

Setup settings are associated with the selected package digest. Staged updates
use a separate candidate configuration; runtime writes resolve the running
version and validate its live activation. A conflict or stale activation must
be surfaced rather than treated as a successful save.

## Storage

```ts
get(key): Promise<Result<JsonValue | null>>
getRecord(key): Promise<Result<{ value: JsonValue | null; revision: number;
    sizeBytes: number; updatedAt: number }>>
set(key, value, { ifRevision? }?): Promise<Result<void>>
delete(key): Promise<Result<void>>
list(prefix?): Promise<Result<readonly StorageListEntry[]>>
listPage({ prefix?, cursor?, limit? }?): Promise<Result<StoragePage>>
```

`StorageListEntry` contains `key`, `sizeBytes`, `updatedAt`, and optional
`revision`. A page contains `entries` and optional `nextCursor`. Continue with
that opaque cursor until it is absent. A page and the older `list()` are capped
at 200 entries; use pages for larger collections.

`ifRevision` is an optional non-negative safe integer or `null` for creation
when no record exists. Deleted keys retain revisions. `getRecord()` returns
that revision even when the value is absent, so a stale pre-delete write cannot
match a recreated value. Re-read after conflicts and decide how to merge.

Each portable stored value is capped at 32 KiB. Aggregate limits are 1000 live
keys and 1 MiB of live values per plugin/workspace,
enforced atomically. A separate 10,000 retained-name cap includes tombstones.
Deleting releases live-value usage, but retains the name/revision; existing
names remain reusable at that cap. These are local admission limits across
materialized and synced rows, not a global reservation across offline devices.
Storage is host-mediated; plugin code should not import database tables.

## Portable UI and requests

`context.render(definePortableUi({ title?, key?, navigation?, nodes }))` sends
validated UI data to the host. The `ui` helpers include text, headings, Markdown,
rows/columns, forms, fields, tables, lists, items, buttons, and progress.
`ui.openDocument()` performs authorized document navigation; `ui.openPane()`
is currently refused by the portable renderer because it has no portable pane-ID
mapping.

`context.onRequest('runtime.ui-event', handler)` receives actions and form values.
Return `{ ok: true, fieldValues: { fieldId: newValue } }` to explicitly replace
fields. One handler should dispatch your actions. `runtime.tools` returns the
chat-tool catalog; `runtime.tool` handles `{ name, args }`. See the
[recipes](/documentation/plugins/add-features) for complete examples and permission changes.

## Command palette

For a trusted-host command with a handler, use `context.commands.register()`;
see [Add features](/documentation/plugins/add-features#use-trusted-host-integrations).
For a searchable shared-post collection, register this SDK contribution:

```js
const source = context.contributions.register({
    kind: 'ui.command-palette.post-source',
    id: 'notes-source',
    definition: {
        id: 'notes-source',
        label: 'Plugin notes',
        postType: 'my-plugin-note',
        categoryId: 'plugin-note',
        filterAliases: ['note'],
        metaKeys: ['completed'],
        openTarget: { kind: 'pane-app', appId: 'my-plugin-notes' },
    },
});
context.onCleanup(() => source.dispose());
```

This needs `ui.command-palette.register` and an actual registered target pane.
IDs/categories are lowercase alphanumeric with hyphens. Aliases are globally
unique, 2–32 characters; metadata is an allowlist of at most 16 scalar keys.
Internal revision post types are forbidden. Search is local to the active
workspace over non-deleted posts; this does not expose a raw Dexie handle or a
remote search provider. Disable removes the source and aliases.

The declarative `ui.command-palette.command` contribution supplies metadata;
it does not take your handler as a serializable field. Use the qualified
command registration API for executable trusted-host behavior. The current
portable adapter's `contributions.register()` accepts only dashboard cards.

## Trusted chat contributions

Register through `context.contributions.register()` and dispose on cleanup:

| Kind | Definition | Permission |
| --- | --- | --- |
| `chat.message.renderer` | `{ match, component }` with a package-owned Vue renderer | `chat.message.renderer` |
| `editor.extension` | `{ extension, suggestion?, onSlashCommand? }` with a package-owned TipTap extension | `chat.editor.extension` |

These integrations do not themselves grant message writes or model calls.
Custom trusted components import `vue` as the host singleton; no app aliases,
Nuxt auto-imports, or second bundled Vue instance are allowed.

## Exports and development-only helpers

| Import | Purpose |
| --- | --- |
| `@or3/plugin-sdk` | Definitions, types, results, UI helpers, portable runtime/client, host AI helpers, SSE decoder |
| `/manifest` | Manifest and permission types |
| `/ui`, `/portable`, `/portable-runtime` | Portable UI, wire client, and activation adapter |
| `/testing` | Fake hosts for local behavior checks; exclude from shipped code |
| `/profile` | Authoring configuration and descriptor validation; keep in `.authoring/` |
| `/package-tree`, `/package-archive`, `/candidate`, `/state-compatibility`, `/plugin-icon` | Packaging/validation utilities; not sandbox runtime imports |
| `/host` | Host context construction; host integration only |

Use [CLI](/documentation/plugins/plugin-sdk-cli) to install a packed SDK. Shipped runtime code must
not import `~/`, `~~/`, `#imports`, `#app`, or depend on Nuxt auto-imports.

`createPortableTestHost()` from `/testing` can activate the real portable adapter
with declared grants and initial settings/storage. The generic `PluginTestHost`
is useful for trusted definitions. These fakes verify local behavior; they do
not prove sandbox containment, browser startup, or installed-runtime support.
Use the real browser lifecycle check before [publishing](/documentation/plugins/publish).


## Trusted SDK 2.1 capabilities

Reviewed `trusted-host` packages can require these feature IDs:

- `or3-trusted-ui-kit-v1`: shared Vue components, reactive theme components, icons, responsive state, chat-input props and syntax highlighting.
- `or3-trusted-host-v2`: persistent storage/settings, scoped secrets, sidebar navigation, pane listing/listeners/targets, Connect, workspace profiles and governed HTTP/multipart/SSE.
- `or3-trusted-chat-records-v1`: posts/messages, composer prefill, send handling, AI provider/models, tools, jobs and lifecycle events.

Feature requirements are checked before setup. Portable clients return `unsupported` for these trusted-only methods.

`ui.kit.components.ChatMessage` is reactive and follows theme changes. `ui.sidebar.show(id)` reports `not-found` for unknown pages. `panes.open` supports core `chat`/`doc`, registered apps and `target: { pane: id }`; `panes.list/onChange` return snapshots. Removing a pane app resets only its panes to empty chats.

`storage` persists JSON in the activation workspace under `or3.plugin.<id>.storage.<key>`; conditional writes use revisions. Values are limited to 32 KiB and each plugin to 1 MiB/1,000 live keys. Settings resolve persisted values, then defaults in the manifest's settings schema, then `public.pluginSettingDefaults[id]`. Disable retains workspace data. Activation clients return `stale-context` after disposal or a workspace switch.

`secrets` uses device-local `or3.plugin.<id>.secret.<key>` keys. Observed sign-out clears them; stale-session startup preserves them. Secrets are never workspace KV values. An unavailable browser store reports `host-unavailable`.

`network.requestAccess({ origins, purpose })` requests one host-owned approval for previously unapproved origins; `revokeAccess` removes approvals immediately. Only HTTPS or loopback HTTP origins without credentials, paths, queries or fragments are accepted. The host keeps approvals outside plugin storage. A plugin can use its own `/api/plugins/<id>/` routes and current Connect endpoints; other same-host routes are denied. Redirects are refused. Multipart bodies support file references plus `{ name, filename, mimeType, data: Uint8Array }` parts, enforce `files.limits()`, and honor cancellation.

`posts` writes only post types declared by registered panes. `chat.messages` writes only assistant messages with a type declared by a registered message renderer (`messageType`). Updates preserve message clocks; `attachFile` consumes a generated file reference and handles duplicate attachment references. File references issued by `files.write` belong to the activation until attached; unused references are released on disposal. Composer prefill uses `chat.composer.prefill`, while `chat.send.markHandled` is valid within the before-send hook.

Additional reviewed grants:

| Grant | Access |
| --- | --- |
| `ui.workspace-profile.register` | Register a workspace layout/navigation profile with host-derived ownership. |
| `ai.provider` | Receive the configured provider client, headers and **raw API key**. Missing credentials return `not-signed-in`; `ai.requestSignIn` opens sign-in. |
| `tools.use` | List and execute enabled tools through their existing approval policy and cancellation. |
| `jobs.background` | Track, inspect and abort workspace background jobs. |
| `hooks.emit` | Emit `workflow.execution:action:start`, `:complete`, `:state_update` and `:node_complete`. |

`ai.models()` includes favorites and metadata; `ai.onModelsChange` follows catalog/favorite changes. Connect status/list/remove require `workspace.connections.read/manage`; disabled deployments return `unsupported`. Listen to `connections.changed` with the read grant.

Trusted server routes obtain their dispatcher identity and reviewed server services through `getPluginServerContext(event)`. Service methods enforce session and grants; routes remain authorized by the dispatcher.

Storage and settings accept bounded JSON values; non-finite numbers are rejected. Storage values and the persisted settings record are limited to 32 KiB. Plugin storage has a 1 MiB / 1,000 live-key quota, with bounded retained revision history. Record writes remain bound to the activation database across asynchronous hooks.

See [Interactive tool cards](/documentation/plugins/tool-cards) for cards attached to tool calls, state, chat actions, embeds and browser qualification.
