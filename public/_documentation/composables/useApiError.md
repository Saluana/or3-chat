# useApiError

Consistent extraction of user-friendly messages from API errors.

## Purpose

`useApiError()` returns `getMessage(err, fallback?)`:

-   Reads `err.data.statusMessage` first (Nuxt fetch error payloads).
-   Falls back to `err.message`.
-   Returns `fallback` (default `'An error occurred'`) when nothing usable exists.

## Usage

```ts
import { useApiError } from '~/composables/useApiError';

const { getMessage } = useApiError();

try {
    await $fetch('/api/something');
} catch (err) {
    toast.add({
        title: 'Request failed',
        description: getMessage(err, 'Something went wrong'),
        color: 'error',
    });
}
```

## Notes

-   Works with any fetch error shape; callers supply their own fallback text.

## Related

-   `useManagedWebhooks` — a consumer of this helper.
