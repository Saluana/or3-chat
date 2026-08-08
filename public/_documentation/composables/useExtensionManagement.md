# useExtensionManagement

Owner-gated wrapper around extension install and uninstall operations for the admin dashboard. It combines the file input with the extension API helpers.

## Purpose

`useExtensionManagement(isOwner)` returns:

-   `fileInput` / `triggerFileInput` — hidden file input for picking an extension file.
-   `install(kind, onSuccess?, workspaceId?)` — install the selected file. Returns `false` for non-owners or missing files.
-   `installFromUrl(kind, url, onSuccess?, workspaceId?)` — install from a URL. Returns `false` for non-owners or blank URLs.
-   `uninstall(id, kind, onSuccess?)` — uninstall an extension (owner only).

`kind` is `'plugin' | 'theme' | 'admin_plugin'`.

## Usage

```ts
import { useExtensionManagement } from '~/composables/admin/useExtensionManagement';
import { useAdminWorkspaceAuth } from '~/composables/admin/useAdminAuth';

const { isOwner } = useAdminWorkspaceAuth();
const { fileInput, triggerFileInput, install, uninstall } =
    useExtensionManagement(isOwner);
```

```vue
<template>
    <input ref="fileInput" type="file" class="hidden" @change="onFile" />
    <UButton @click="triggerFileInput">Install plugin</UButton>
</template>
```

## Notes

-   Every operation silently no-ops (returns `false`/void) when the caller is not an owner.
-   Use `useConfirmDialog` before destructive uninstalls.

## Related

-   `useAdminExtensions` — the raw install/uninstall helpers.
-   `useAdminAuth` — the `isOwner` source.
