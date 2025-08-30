# Extensible Chat Message Actions

This document explains how to add custom action buttons to each chat message beside the built‑in actions (Copy, Retry, Branch, Edit).

Custom actions:

-   Keep the same visual style (they are appended inside the existing `<UButtonGroup>`)
-   Can target user messages, assistant messages, or both
-   Provide their own icon + tooltip
-   Run arbitrary async/await logic when clicked

Underlying implementation lives in `app/composables/useMessageActions.ts`.

## Quick Start

Register your action during app startup (e.g. in a Nuxt plugin `plugins/message-actions.client.ts`).

```ts
// plugins/message-actions.client.ts
import { registerMessageAction } from '~/composables/useMessageActions';

export default defineNuxtPlugin(() => {
    registerMessageAction({
        id: 'share-link', // unique id
        icon: 'pixelarticons:export', // any icon name supported by <UButton>
        tooltip: 'Share link',
        showOn: 'assistant', // 'user' | 'assistant' | 'both'
        order: 300, // optional; after built-ins ( <200 reserved )
        async handler({ message, threadId }) {
            // Your custom logic
            const url = `${location.origin}/thread/${threadId}?anchor=${message.id}`;
            await navigator.clipboard.writeText(url);
            const { useToast } = await import('#imports');
            useToast().add({
                title: 'Link copied',
                description: 'Thread link copied to clipboard.',
                duration: 2500,
            });
        },
    });
});
```

That's it—your button will render automatically on matching messages.

## API Reference

### registerMessageAction(action)

Registers (or replaces) a message action.

```ts
interface ChatMessageAction {
    id: string; // unique key
    icon: string; // passed to <UButton icon="...">
    tooltip: string; // tooltip text
    showOn: 'user' | 'assistant' | 'both';
    order?: number; // lower appears earlier (built-ins < 200). Default 200.
    handler: (ctx: { message: any; threadId?: string }) => void | Promise<void>;
}
```

Guidelines:

-   Prefer ids with a namespace (`ext:foo`, `myplugin.share`) to avoid collisions
-   Omit `order` or use `>= 200` to appear after built-ins; use `< 200` only if you intentionally need to inject before them
-   Keep handlers fast; offload long work (API calls) to background if possible

### unregisterMessageAction(id)

Remove an action (useful for HMR cleanup or conditional modules).

### useMessageActions(message)

Returns a computed array of actions (already filtered & ordered) for a given message role. You normally don't need this directly—`ChatMessage.vue` uses it under the hood. Provided for advanced embedding scenarios.

### listRegisteredMessageActionIds()

Debug helper to introspect current registry.

## Execution Context

`handler({ message, threadId })` receives:

-   `message`: The UI message object currently rendered
-   `threadId`: Optional thread id passed down by `ChatMessage.vue`

You can read message fields (`id`, `role`, `content`, etc.) or augment them if needed.

## Error Handling

Errors thrown in `handler` are caught; a toast titled "Action failed" appears and the error is logged to console. Throwing is fine; you don't have to wrap with try/catch unless you want custom UX.

## Async Patterns & Loading UX

Short operations (clipboard, small local transforms) need no extra UI.
For longer tasks you might:

```ts
registerMessageAction({
    id: 'summarize',
    icon: 'pixelarticons:text',
    tooltip: 'Summarize message',
    showOn: 'assistant',
    async handler({ message }) {
        const { useToast } = await import('#imports');
        const t = useToast();
        const notice = t.add({ title: 'Summarizing…', timeout: 0 });
        try {
            const res = await $fetch('/api/summarize', {
                method: 'POST',
                body: { content: message.content },
            });
            t.add({
                title: 'Summary',
                description: res.summary,
                duration: 4000,
            });
        } finally {
            notice.dismiss();
        }
    },
});
```

If you need a visible loading state on the button itself, currently the base component does not expose per-action loading—simplest path is to show a toast with a spinner or set some shared reactive state your handler toggles.

## Ordering Rules

1. Built-ins (Copy, Retry, Branch, Edit) are rendered first; treat their implicit range as order < 200.
2. Custom actions default to order 200.
3. You can override order to interleave actions (e.g. `order: 150` to appear before Edit if you add more built-ins later).

## Role Targeting Examples

```ts
showOn: 'user'; // only user messages
showOn: 'assistant'; // only assistant messages
showOn: 'both'; // every message
```

## HMR & Duplication Safety

The registry is stored on `globalThis.__or3MessageActionsRegistry`, so repeated imports during HMR won't duplicate entries. Re-registering with the same `id` replaces the existing definition.

## Unregister Example

```ts
import { unregisterMessageAction } from '~/composables/useMessageActions';
unregisterMessageAction('share-link');
```

## Debugging Tips

Open devtools console:

```js
listRegisteredMessageActionIds();
```

Ensure icons exist (check your icon pack). A missing icon typically renders an empty box.

## Extending Further

Potential enhancements (PRs welcome):

-   Per-action loading / disabled state
-   Conditional visibility based on message content (could be solved today by registering dynamically when conditions match)
-   Grouping or separators for large sets

## Minimal Boilerplate Template

```ts
registerMessageAction({
    id: 'ext:template',
    icon: 'pixelarticons:star',
    tooltip: 'Do something',
    showOn: 'both',
    async handler({ message, threadId }) {
        // implement
    },
});
```

Happy extending!
