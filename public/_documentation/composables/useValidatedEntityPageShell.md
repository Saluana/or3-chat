# useValidatedEntityPageShell

Page guard for entity detail routes. It loads the route entity, redirects when it is missing or deleted, and only then marks the page ready to render.

## Purpose

`useValidatedEntityPageShell<T>(options)` returns:

-   `ready` — `Ref<boolean>`; `true` once the entity loaded and passed validation.
-   `routeId` — computed `route.params.id` as a string.

Options:

```ts
{
    loadEntity: (id: string) => Promise<T | null | undefined>;
    redirectTo: string;                       // route to navigate to on failure
    isDeleted?: (entity: T) => boolean;       // custom deleted check
}
```

Behavior:

-   Opens the Dexie database if it is closed.
-   Loads the entity; missing or deleted entities (default check: `entity.deleted === true`) redirect to `redirectTo` with `replace: true`.
-   Load errors also redirect.

## Usage

```ts
import { useValidatedEntityPageShell } from '~/composables/useValidatedEntityPageShell';

const { ready, routeId } = useValidatedEntityPageShell({
    loadEntity: (id) => getDb().posts.get(id),
    redirectTo: '/documents',
});
```

```vue
<template>
    <div v-if="ready"><DocumentViewer :id="routeId" /></div>
</template>
```

## Notes

-   Validation runs on mount, so SSR renders nothing until the client confirms the entity exists.

## Related

-   `recordValidation` — the retry-based validation helper this pattern builds on.
