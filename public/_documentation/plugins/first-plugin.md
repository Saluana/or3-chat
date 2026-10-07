# Build your first plugin

Build a portable greeting app with a form and a saved value. You will see it
running in OR3, edit it without repeated uploads, and verify that the value
survives a reload and a disable/re-enable cycle. No model key or marketplace
account is needed.

## Before you start

Use Bun 1.3.6 or newer, an OR3 Chat source checkout with dependencies installed,
and the sibling `or3-provider-basic-auth` checkout used by the local host. Use a
Chromium browser. This is the source developer workflow; ordinary users install
plugins through [Marketplace](/documentation/plugins/install-and-manage).

Choose a new, empty directory and a stable lowercase plugin ID. If you intend
to publish later, choose an ID under your marketplace developer namespace;
`my-tools.greeting` is a placeholder.

## 1. Create and open the app

From the OR3 Chat checkout:

```sh
bun run dev:plugin --create /absolute/path/to/greeting --id my-tools.greeting
```

The command packs the local SDK, installs a portable starter, and starts a
separate loopback host with its own data. Open the printed URL, sign in with
the printed local credentials, and review the starter's requested permissions.
Use the printed port: the watcher chooses another port if its default is busy.

You should see the starter's greeting in a plugin surface. Later sessions start
from the plugin directory:

```sh
cd /absolute/path/to/greeting
bun run dev
```

If you created a package separately, link the host once with
`bun run dev --host /absolute/path/to/or3-chat`.

## 2. Understand the files

| File | What you edit |
| --- | --- |
| `client.mjs` | The entry module: plugin definition, UI, and interaction handlers |
| `.authoring/profile.config.mjs` | Manifest fields, permissions, destinations, and setup configuration |
| `.authoring/generate.mjs` | Generates descriptors from that configuration |
| `or3.manifest.json` | Generated identity, runtime, permissions, and compatibility metadata |
| `or3.package-policy.json` | Generated data scopes, writes, connections, and destinations |
| `or3.setup.json` | Generated host setup form and first-action descriptor |
| `settings.schema.json` | Schema for setup settings |
| `client.test.mjs` | Starter checks; extend behavior coverage as your app grows |

The starter uses `settings.read`, `settings.write`, and
`ui.dashboard.register`. This tutorial uses those existing permissions. Edit
configuration in `.authoring/profile.config.mjs`, rather than hand-editing
generated descriptors. The watcher regenerates them; manually run
`bun run profile:generate` when working without the watcher.

## 3. Add a form and save button

In `client.mjs`, keep the starter's `exampleManifest` export and imports. Replace
its `export default createPortablePlugin(...)` block with this one. The starter
already imports all four helpers used below.

```js
export default createPortablePlugin(
    defineOr3Plugin({
        manifest: exampleManifest,
        async setup(context) {
            const stored = await context.settings.get('greeting');
            let greeting = stored.ok && typeof stored.value === 'string'
                ? stored.value
                : 'Hello from OR3';
            let status = stored.ok ? 'Ready' : stored.error.message;

            function render() {
                context.render(definePortableUi({
                    title: 'Greeting app',
                    nodes: [
                        ui.text(`Saved greeting: ${greeting}`),
                        ui.form('greeting-form', [
                            ui.textField('greeting', 'Greeting', {
                                value: greeting,
                                required: true,
                            }),
                            ui.button('save', 'Save greeting', 'submit'),
                        ]),
                        ui.text(status),
                    ],
                }));
            }

            context.onRequest('runtime.ui-event', async (params) => {
                if (params.action !== 'submit') return { ok: true };
                const next = typeof params.values?.greeting === 'string'
                    ? params.values.greeting.trim()
                    : '';
                if (!next) {
                    status = 'Enter a greeting.';
                    render();
                    return { ok: false };
                }
                const saved = await context.settings.set('greeting', next);
                if (!saved.ok) {
                    status = saved.error.message;
                    render();
                    return { ok: false };
                }
                greeting = next;
                status = 'Saved';
                render();
                return { ok: true, fieldValues: { greeting } };
            });
            render();
        },
    })
);
```

Save the file. The watcher builds, checks, and replaces the running worker.
You should see **Greeting app**, an input, and **Save greeting**. Type a value
such as `Hello, workspace!` and save. The saved greeting and **Saved** status
should appear only after the host confirms the write.

`ui.*` describes data; OR3 renders the controls. A button with action `submit`
uses the form's native validation. The host sends the current field values to
`runtime.ui-event`. Returning `fieldValues` explicitly replaces the input with
the trimmed saved value. A render alone preserves a user's dirty fields.

## 4. Verify persistence and lifecycle

1. Save `Hello, workspace!`, then reload the browser. Confirm the saved greeting
   and input still contain that value.
2. Change a label in `client.mjs` and save. Confirm the UI updates and the
   saved greeting survives the worker replacement.
3. Disable the plugin for this workspace using the installed-plugin control.
   Its workspace UI should become unavailable.
4. Re-enable it, reopen the plugin, and confirm the greeting remains saved.
5. Optionally switch to another workspace and configure its greeting. Values
   are workspace-scoped; changing that workspace must not replace the first one's.

Save screenshots of the greeting before reload and after re-enabling, along
with the plugin ID and version. For a release candidate, also export the host's
verification receipt as described in [Publish your plugin](/documentation/plugins/publish). These
make the browser check repeatable and tie it to the package you tested.

## 5. Check the package

From the plugin directory:

```sh
bun run profile:check
./node_modules/.bin/or3-plugin validate .
./node_modules/.bin/or3-plugin test .
./node_modules/.bin/or3-plugin build .
./node_modules/.bin/or3-plugin pack . --archive ../greeting.or3pkg
./node_modules/.bin/or3-plugin inspect ../greeting.or3pkg
```

The starter tests still check package structure; they do not establish that
saving works in the browser. The lifecycle check above verifies that behavior.
After source edits, build again before packing. Watcher outputs are disposable
local candidates; [publishing](/documentation/plugins/publish) freezes a separate, explicit candidate.

## When something goes wrong

| Symptom | Next step |
| --- | --- |
| Missing basic-auth checkout or dependencies | Restore the required local provider checkout and install the host dependencies |
| Port already used | Open the URL printed by the watcher; do not assume port 3000 or 3101 |
| Save has a build error | Fix the reported source error and save again; the last admitted package remains selected |
| New permissions need review | Review the exact requested access in the development host |
| Plugin runs but a write is refused | Check the error shown by the app, workspace permissions, and setup readiness |
| Existing plugin cannot find its host | Run `bun run dev --host /absolute/path/to/or3-chat` |

The host association lives in ignored `.or3-dev/`. Host data lives in the
checkout's `.or3-plugin-dev/` profile. Keep both out of your release source and
keep this profile separate from production data. Stop the watcher with Ctrl+C.

Continue with [Add features](/documentation/plugins/add-features), or look up a method in the
[SDK reference](/documentation/plugins/plugin-sdk).

## Trusted UI packages

For reviewed Vue UI packages, use SDK 2.1 and declare the trusted feature IDs and grants described in [SDK reference](/documentation/plugins/plugin-sdk). Build adapters from public clients; keep domain protocols and data interpretation in the package. Register record types before reconciliation, dispose listeners with activation, and handle `stale-context` on workspace changes.
