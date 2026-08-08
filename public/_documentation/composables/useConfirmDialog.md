# useConfirmDialog

Shared confirmation dialog controller. Any component can open a modal confirm and await the user's choice as a promise.

## Purpose

`useConfirmDialog()` returns:

-   `isOpen` — writable computed for the shared modal state (setting it to `false` resolves any pending confirm as declined).
-   `options` — the current `ConfirmOptions` for the modal.
-   `confirm(opts)` — open the dialog; resolves `true` or `false` when the user decides.
-   `onConfirm()` — user pressed confirm; resolves `true`.
-   `onCancel()` — user pressed cancel; resolves `false`.

`ConfirmOptions`:

```ts
{
    title: string;
    message: string;
    confirmText?: string;
    danger?: boolean;
    importantNote?: string;
    noteTone?: 'info' | 'warning';
}
```

## Usage

```ts
import { useConfirmDialog } from '~/composables/admin/useConfirmDialog';

const { confirm } = useConfirmDialog();

const ok = await confirm({
    title: 'Delete extension?',
    message: 'This cannot be undone.',
    confirmText: 'Delete',
    danger: true,
});
if (ok) await deleteExtension();
```

## Notes

-   State is module-level, so the host modal renders once and every caller shares it.
-   Closing the modal via the X button or overlay counts as cancel.

## Related

-   `useServerRestart` — uses this dialog before restarting the server.
