# useAdminWorkspaceGate

Gate that shows the workspace selector for super admins who have not picked a workspace yet. It coordinates the session kind with the workspace context.

## Purpose

`useAdminWorkspaceGate(refreshWorkspace?)` returns:

-   `selectedWorkspaceId` — the current selection from `useAdminWorkspaceContext`.
-   `showWorkspaceSelector` — reactive flag. It is `true` when the session kind is `super_admin` and no workspace is selected.
-   `onWorkspaceSelected(workspace)` — accept a selection and hand it to the context.

When a workspace is selected, the selector hides and `refreshWorkspace(selectedWorkspaceId)` is called if provided, so dependent fetches reload.

## Usage

```vue
<script setup lang="ts">
import { useAdminWorkspaceGate } from '~/composables/admin/useAdminWorkspaceGate';
import { useAdminWorkspace } from '~/composables/admin/useAdminData';

const { selectedWorkspaceId, showWorkspaceSelector, onWorkspaceSelected } =
    useAdminWorkspaceGate();
const { refresh } = useAdminWorkspace(selectedWorkspaceId);
</script>

<template>
    <WorkspaceSelector
        v-if="showWorkspaceSelector"
        @select="onWorkspaceSelected"
    />
</template>
```

## Notes

-   Clearing the selection for a super admin re-opens the selector.
-   Regular admins never see the selector; the server resolves their workspace from the session.

## Related

-   `useAdminWorkspaceContext` — the underlying selection state.
-   `useAdminSession` — session kind detection.
