# useServerRestart

Owner-gated server restart flow with confirmation and toast feedback.

## Purpose

`useServerRestart(isOwner, allowRestart?)` returns:

-   `restart()` — confirm with the user, then POST `/api/admin/system/restart`.
-   `restartRequired` — reactive flag the dashboard can set when a config change needs a restart.

Behavior:

-   Non-owners no-op.
-   If `allowRestart` is `false`, a "Restart Disabled" toast is shown.
-   Unconfirmed dialogs abort.
-   In development mode the server refuses; a toast explains how to restart manually.
-   Errors surface as toasts via `parseErrorMessage`.

## Usage

```ts
import { useServerRestart } from '~/composables/admin/useServerRestart';
import { useAdminWorkspaceAuth } from '~/composables/admin/useAdminAuth';

const { isOwner } = useAdminWorkspaceAuth();
const { restart, restartRequired } = useServerRestart(isOwner);

async function saveAndRestart() {
    await saveConfig();
    restartRequired.value = true;
    await restart();
}
```

## Notes

-   Requests include the admin intent header.
-   Wire `restartRequired` to a banner so owners know a restart is pending.

## Related

-   `useConfirmDialog` — the confirmation step.
-   `useAdminExtensions` — the shared `ADMIN_HEADERS`.
