# Add features to your plugin

Start with [Build your first plugin](/documentation/plugins/first-plugin). The recipes below extend
its portable app; the last section covers trusted-host integrations. Before
adding a capability, declare its permission in the authoring configuration,
regenerate descriptors, and review the new access in the local host.

## Build a workspace interface

Use `definePortableUi()` and `ui` from `@or3/plugin-sdk`. The host renders text,
Markdown, forms, lists, tables, progress, and buttons with its own theme. It does
not accept plugin HTML, CSS, Vue components, or DOM handlers in portable views.

Inside `setup(context)`, render a list with a matching navigation view:

```js
context.features.require('or3-portable-workspace-v1');
context.render(definePortableUi({
    key: 'inbox',
    title: 'My list',
    navigation: [
        ui.item({ id: 'inbox', label: 'Inbox', action: 'navigation.open:inbox' }),
    ],
    nodes: [
        ui.heading('Inbox'),
        ui.item({ id: 'first', label: 'My first item', action: 'select:first' }),
    ],
}));
context.onRequest('runtime.ui-event', async ({ action }) => {
    // Handle navigation.open:inbox or select:first here, then render the new view.
    return { ok: true };
});
```

Add `or3-portable-workspace-v1` to `authoringConfig.features`. Navigation is
shown in the sidebar; `nodes` is the workspace content. The host supplies the
pane, sidebar registration, and dashboard entry. `navigation.open:` actions
also open or focus the plugin's workspace tab after the plugin handles them.

For a main view and inspector, use a `columns` node with `layout: 'workspace'`
and `column` children. The content and inspector scroll separately; on a narrow
pane the inspector becomes a drawer. Split views currently share the activation's
selection, rather than providing independent per-list tabs.

Use stable field IDs. A render preserves typed values; return `fieldValues` from
an interaction to replace them intentionally. Changing the view `key` resets
field state. Text fields can declare `onChange` for debounced live search; select
fields dispatch their declared action immediately. Keep lists and results bounded.

## Save application data

Use settings for configuration declared by your setup schema, and storage for
app data such as items or presets. Add `storage.read` to `dataScopes`,
`storage.write` to `writes`, and both to `baseManifest.requestedGrants`.

```js
const record = await context.storage.getRecord('draft');
if (!record.ok) throw new Error(record.error.message);

const saved = await context.storage.set('draft', { text: 'My draft' }, {
    ifRevision: record.value.revision,
});
if (!saved.ok) {
    // Show the refusal. A conflict means another writer changed the record.
    context.render(definePortableUi({ nodes: [ui.text(saved.error.message)] }));
}
```

`getRecord()` includes a revision even for an absent/deleted value. Use that
revision for a conditional update; use `ifRevision: null` only for a new name
that has no retained revision. Re-read after a conflict instead of overwriting
another writer. [SDK storage reference](/documentation/plugins/plugin-sdk#storage) documents quotas
and paging. Saved values belong to the plugin and workspace. Do not import Dexie
or use browser storage directly from the sandbox.

## Expose a chat tool

Add `tools.register.client` to `requestedGrants`. In `setup(context)`:

```js
const name = `${context.pluginId.replace(/[^a-z0-9]/g, '_')}_count_words`;
context.onRequest('runtime.tools', () => [{
    type: 'function',
    function: {
        name,
        description: 'Count words in supplied text.',
        parameters: {
            type: 'object',
            properties: { text: { type: 'string' } },
            required: ['text'],
            additionalProperties: false,
        },
    },
}]);
context.onRequest('runtime.tool', (params) => {
    if (params.name !== name) throw new Error('Unknown tool');
    const text = typeof params.args?.text === 'string' ? params.args.text.trim() : '';
    return { words: text ? text.split(/\s+/).length : 0 };
});
```

Open chat settings, enter the plugin's tool group, and enable the tool before
asking the model to use it. Tools start disabled. The host chooses their group
from the reviewed plugin name. A catalog has at most 32 tools; names use the
normalized plugin prefix, contain letters/digits/underscores, and are at most
64 characters. Disable, update, and workspace teardown remove the registrations.
This recipe counts supplied text; it does not grant access to arbitrary documents.

## Work with a document

Add `documents.read` to `dataScopes` and `requestedGrants` for selected context.
Add `documents.write` to `writes` and `requestedGrants` only if you also offer a
host-approved write. In the profile configuration, add a first action such as:

```js
firstAction: {
    operationId: 'documents.read',
    label: 'Count selected words',
    usesSampleContext: true,
    samplePath: 'samples/example.md',
},
```

Create that sample file in the package. A real selection takes precedence;
the sample is used when there is no selection. Without `samplePath`, an action
requiring context needs a selection. Missing declared samples fail validation.

Handle the first action through the same UI request channel:

```js
context.onRequest('runtime.ui-event', (params) => {
    if (params.action !== 'host.first-action.run') return { ok: true };
    const text = typeof params.context?.content === 'string' ? params.context.content : '';
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    context.render(definePortableUi({ nodes: [ui.result('Word count', String(words))] }));
    return { ok: true };
});
```

Use one `runtime.ui-event` handler that branches on action if your plugin also
has forms; a second registration for the same method replaces the first.
Open the plugin and use its first-action control. Configure checks readiness
and prepares the handoff; the running plugin surface executes the interaction.
The host validates the selected context against the live activation and approved
read permission before passing text to the worker.

To offer **Create new document**, add the write permission described above and
replace the word-count handler with this one:

```js
let output = null;
context.onRequest('runtime.ui-event', (params) => {
    if (params.action === 'host.document.create') {
        return output ?? { title: '', content: '' };
    }
    if (params.action !== 'host.first-action.run') return { ok: true };
    const text = typeof params.context?.content === 'string' ? params.context.content : '';
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    output = { title: 'Word count', content: `Word count: ${words}` };
    context.render(definePortableUi({ nodes: [
        ui.result(output.title, output.content),
        ui.button('create', 'Create new document', 'host.document.create'),
    ] }));
    return { ok: true };
});
```

The reserved button action starts a host-owned write. The host asks your handler
for `{ title, content }`, validates it, and performs the write after the user
clicks. Return the same content you previewed, rather than recomputing it during
the write. An empty payload is refused.

`host.document.replace` uses the same payload shape, but requires a selected
document and a confirmation of the frozen content. `host.chat.continue` creates
a chat handoff and also requires `documents.write` on this host. Study
`official-plugins/or3-document-utilities/client.mjs` for a complete transformation
and preview flow.

A `documents.write` permission does not expose a general document database or
allow a plugin to choose an arbitrary replacement target. Test both the sample
and a selected document, and confirm that canceling a replacement leaves the
document unchanged.

## Call an approved model

Portable model calls currently use the `network.http` permission. There must
also be host-configured models, prices, and a provider credential. The dedicated
local host does not require a key until you test a model-backed feature.

```js
const catalog = await context.ai.models();
if (!catalog.ok) throw new Error(catalog.error.message);
const model = catalog.value.models.find((entry) => entry.priced);
if (!model) throw new Error('No priced model is available.');

// Run this after an explicit user action, with prices shown in your view.
const completion = await context.ai.complete({
    model: model.id,
    prompt: 'Suggest a concise document title.',
    maxOutputTokens: 64,
});
if (!completion.ok) throw new Error(completion.error.message);
```

The host enforces allowlists, output limits, concurrency, and plugin-attributed
spend. Display refusals and provider costs. Never retry an uncertain paid call
without an explicit user action. [Connections](/documentation/plugins/connections) explains why a
connection cannot bypass this policy, and [Runtime and security](/documentation/plugins/runtime-and-security)
explains operator model configuration.

## Use trusted-host integrations

Choose `minimal-v2` with the [CLI](/documentation/plugins/plugin-sdk-cli) when custom Vue or host
integrations are required. Set `trust: 'trusted-host'` and client
`isolation: 'host'`. These packages run with the host's trust boundary and require
reviewed permissions and the host Vue import-map check.

For a useful command-palette command, request `commands.register` and register
the handler through the SDK inside `setup(context)`:

```js
const command = context.commands.register({
    id: `${context.pluginId}.hello`,
    label: 'Log a greeting',
    keywords: ['greeting'],
}, async () => {
    context.logger.info('Hello from my plugin');
    return { ok: true, value: null };
});
context.onCleanup(() => command.dispose());
```

Use `context.contributions.register()` with `ui.command-palette.post-source`
for searchable, non-deleted shared posts of your app's type. It requires
`ui.command-palette.register`; post aliases and indexed metadata are bounded.
The SDK [command-palette example](/documentation/plugins/plugin-sdk#command-palette) shows the shape.
Registering declarative command metadata alone does not supply a business-logic
handler. The current portable `createPortablePlugin()` adapter renders dashboard
card contributions only; do not copy trusted-host contribution examples into it.

For a Vue sidebar, request `ui.sidebar.register`, call
`context.ui.registerSidebar({ id, label, component })`, and dispose the returned
handle on cleanup. Chat renderers use `chat.message.renderer`; editor extensions
use `chat.editor.extension`. Packages import `vue` and `@or3/plugin-sdk` as host
singletons, never app aliases or Nuxt auto-imports. Rebuild before packing and
verify that disabling removes every registration while retaining saved data.

See [Interactive tool cards](/documentation/plugins/tool-cards) for cards attached to tool calls, state, chat actions, embeds and browser qualification.
