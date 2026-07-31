# Command Palette Plugin API

Plugins can contribute local searchable records and commands to OR3's global
command palette. The Cmd/Ctrl+K overlay consumes these registrations
immediately and removes them with the owning plugin scope.

## Grants and contribution kinds (Plugin Runtime V2)

- Grant: `ui.command-palette.register`
- Contribution kinds:
  - `ui.command-palette.post-source`
  - `ui.command-palette.command`
- Surface id: `command-palette`

Isolated plugins must keep command definitions declarative. Execution happens
through a host-mediated command channel; handlers are never serialized across
iframe or worker boundaries.

## V1 workspace plugin API

```ts
api.registerCommandPalettePostSource({
  id: 'todo-source',
  label: 'Todos',
  postType: 'example-todo',
  categoryId: 'todo',
  filterAliases: ['todo'],
  metaKeys: ['completed'],
  openTarget: { kind: 'pane-app', appId: 'example-todo' },
});

api.registerCommandPaletteCommand(
  {
    id: 'todo-new',
    label: 'New todo',
    keywords: ['task'],
  },
  async () => {
    // create todo…
    return { ok: true };
  }
);
```

Both registrations dispose with the plugin cleanup scope.

## Post-source rules

- `id`, `categoryId`, and aliases are lowercase alphanumeric with hyphens.
- Aliases are 2–32 characters and globally unique.
- `postType` must not be an internal revision type.
- `metaKeys` is an allowlist (max 16). Only string/number/boolean/null values are indexed.
- The host queries non-deleted Dexie posts for the declared `postType`.
- Plugins do not receive a Dexie handle from this feature.

## Query aliases

Core aliases include `chat:`, `doc:`, `project:`, `workflow:`, `image:`,
`setting:`, `dashboard:`, and `command:`. Plugins may add aliases such as
`todo:` via post-source registration.

## Examples

- Workflows register `workflow-entry` through the public post-source API
  (`app/plugins/workflows.client.ts`).
- The todo pane example registers `todo:` with searchable `completed` metadata
  (`app/plugins/examples/custom-pane-todo-example.client.ts`).

Both examples use `Or3WorkspacePluginApi`; plugins should not import the
internal palette registry or source modules directly.

## Limitations (v1)

- Local shared-post search only; no remote/network search providers.
- No custom Vue preview components from plugins.
- Indexes stay in memory for the active workspace and are not synced.
