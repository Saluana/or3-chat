# useAdminExtensions

Client helpers for installing and uninstalling extensions (plugins, themes, and admin plugins) from the admin dashboard.

## What it does

The module exports types plus two groups of functions:

-   Data model — `ExtensionKind` (`'plugin' | 'theme' | 'admin_plugin'`), `ExtensionItem`, `ExtensionInstallOptions`, and `ExtensionInstallResult`.
-   Operations — `installExtension({ kind, file, onSuccess, workspaceId? })` uploads a file to `/api/admin/extensions`, and `installExtensionFromUrl(...)` installs from a URL. `uninstallExtension(id, kind, onSuccess)` removes one.
-   `useFileInput()` — returns `{ fileInput, triggerFileInput }` for driving a hidden file input.

All requests send the `ADMIN_HEADERS` (`x-or3-admin-intent: admin`) and parse errors into readable messages.

## Usage

```ts
import { useFileInput } from '~/composables/admin/useAdminExtensions';
import { useExtensionManagement } from '~/composables/admin/useExtensionManagement';

const { fileInput, triggerFileInput } = useFileInput();
```

## Notes

-   Prefer `useExtensionManagement`, which wraps these helpers with owner checks and the file input.

## Related

-   `useExtensionManagement` — the recommended wrapper.
-   `useAdminPlugins` — registering admin pages and widgets.
