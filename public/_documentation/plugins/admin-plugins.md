# Admin plugins

Admin plugins add trusted client-side pages and overview widgets to the global
admin dashboard. They are a separate V1 extension kind from workspace plugins
and only load when SSR authentication is enabled.

## Package layout

An installable ZIP must contain these files at its package root (one enclosing
archive directory is also accepted):

```text
or3.manifest.json
admin.plugin.ts
components/
  ExampleAdminPage.vue
```

Use a V1 manifest:

```json
{
  "kind": "admin_plugin",
  "id": "example-admin",
  "name": "Example admin tools",
  "version": "1.0.0",
  "capabilities": []
}
```

`version` must be a non-empty string for V1 compatibility; semantic versioning
is recommended.

## Entrypoint

Default-export an object with a stable `id` and a `register(api)` method:

```ts
import ExampleAdminPage from './components/ExampleAdminPage.vue';
import ExampleOverviewWidget from './components/ExampleOverviewWidget.vue';

export default {
    id: 'example-admin',
    register(api) {
        api.registerAdminPage({
            id: 'example-admin-settings',
            label: 'Example',
            path: 'example',
            order: 200,
            component: ExampleAdminPage,
        });

        api.registerAdminWidget({
            id: 'example-admin-status',
            slot: 'overview',
            order: 200,
            component: ExampleOverviewWidget,
        });
    },
};
```

An admin page is linked in the admin navigation and rendered at
`/admin/extensions/<path>`. If `path` is omitted, the page `id` is used.

`overview` is the widget slot currently rendered by the host. The API reserves
`workspace`, `plugins`, `themes`, and `system`, but those slots do not yet have
host renderers.

Components may also be lazy loaders:

```ts
component: () => import('./components/ExampleAdminPage.vue')
```

## Install and remove

There is no dedicated admin-plugin installer screen. Use the owner-only
extension API and declare the expected kind:

```ts
const form = new FormData();
form.append('file', zipFile);
form.append('expectedKind', 'admin_plugin');

const result = await $fetch('/api/admin/extensions/install', {
    method: 'POST',
    headers: { 'x-or3-admin-intent': 'admin' },
    body: form,
});
```

The endpoint returns `restartRequired: true`. Discovery uses a build-time Vite
glob, so a production deployment must be rebuilt and restarted after install or
uninstall. Restarting an unchanged production bundle is not sufficient.

To uninstall:

```ts
await $fetch('/api/admin/extensions/uninstall', {
    method: 'POST',
    headers: { 'x-or3-admin-intent': 'admin' },
    body: { id: 'example-admin', kind: 'admin_plugin' },
});
```

## Current lifecycle and security limits

- Admin plugins are trusted host code, not a sandbox.
- They load only on the client, after the global admin authentication feature is
  enabled.
- `OR3_DISABLE_NON_CORE_PLUGINS` safe mode prevents discovery.
- Registration is load-once for the current client runtime. The API does not
  currently provide unload handles or dynamic enable/disable.
- Workspace plugin access policies and workspace enable lists do not govern
  admin plugins. The admin route and admin authentication middleware are the
  security boundary.
- The manifest ID, package directory, and exported plugin ID should be kept
  identical. The current loader does not enforce the exported ID.
