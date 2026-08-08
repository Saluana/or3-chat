# useManagedWebhooks

Controller for the managed webhooks dashboard page. It loads webhooks, handles create/edit/log UI state, and performs delete, toggle, bulk-disable, and test-ping operations with toast feedback.

## Purpose

`useManagedWebhooks(options)` returns:

-   `webhooks` — loaded webhooks list.
-   `pending` — initial fetch flag.
-   `errorMessage` — friendly load error, or `null`.
-   `refresh()` — reload the list.
-   UI state — `formOpen`, `logsOpen`, `editingWebhook`, `activeLogWebhook`, `testingId`, `testResult`, `bulkDisabling`.
-   Actions — `openCreate()`, `openEdit(webhook)`, `openLogs(webhook)`, `handleSaved()`, `deleteWebhook(webhook)`, `toggleWebhook(webhook)`, `disableAll()`, `sendTestPing(webhook)`.
-   `workspaceOptions` — optional workspace list for the form.

## Options

```ts
{
    endpoint: string;              // webhooks API base
    loadErrorMessage: string;
    deleteErrorMessage: string;
    updateErrorMessage: string;
    testErrorMessage: string;
    workspaceOptions?: { endpoint; query? };   // workspace picker data
    bulkDisable?: { endpoint; confirmMessage; successTitle; successDescription; failureDescription };
}
```

## Usage

```ts
import { useManagedWebhooks } from '~/composables/webhooks/useManagedWebhooks';

const webhooks = await useManagedWebhooks({
    endpoint: '/api/admin/webhooks',
    loadErrorMessage: 'Failed to load webhooks',
    deleteErrorMessage: 'Failed to delete webhook',
    updateErrorMessage: 'Failed to update webhook',
    testErrorMessage: 'Failed to send test ping',
});
```

## Notes

-   Destructive actions confirm via `window.confirm` first.
-   Errors are normalized through `useApiError` and shown as toasts.

## Related

-   `useApiError` — error message extraction.
-   Webhooks API docs under the dashboard section.
