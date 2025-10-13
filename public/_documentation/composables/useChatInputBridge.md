# useChatInputBridge

Lightweight registry that lets external features (pane plugins, slash commands, automation) inject chat messages into an existing chat input without duplicating business logic.

---

## Why it exists

`useChatInputBridge` exposes a tiny, reactive directory of chat inputs keyed by `paneId`. Chat containers register their imperative API and the bridge forwards programmatic sends through the same UI pipeline a user click would trigger.

-   Keeps message handling inside `ChatInputDropper`
-   Avoids rehydrating chat state or bypassing hooks
-   Supports multiple panes/windows
-   Safe in dev (HMR-resilient)

---

## Surface area

| Function              | Signature                                               | Purpose                                                                                                    |
| --------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `registerPaneInput`   | `(paneId: string, api: ChatInputImperativeApi) => void` | Register or update the imperative API for a pane. Called by the chat input component on mount/HMR.         |
| `unregisterPaneInput` | `(paneId: string) => void`                              | Remove the pane entry on unmount.                                                                          |
| `programmaticSend`    | `(paneId: string, text: string) => boolean`             | Push text into the pane input and trigger its native send handler. Returns `false` if the pane is missing. |
| `hasPane`             | `(paneId: string) => boolean`                           | Test whether a pane is currently registered.                                                               |

### `ChatInputImperativeApi`

```ts
interface ChatInputImperativeApi {
    setText(t: string): void;
    triggerSend(): void;
}
```

---

## Typical usage

### Registering inside a chat pane

```ts
import { onMounted, onUnmounted } from 'vue';
import {
    registerPaneInput,
    unregisterPaneInput,
} from '~/composables/chat/useChatInputBridge';

const paneId = usePaneId();

onMounted(() => {
    registerPaneInput(paneId, {
        setText: (value) => (messageInput.value = value),
        triggerSend: () => sendMessage(),
    });
});

onUnmounted(() => {
    unregisterPaneInput(paneId);
});
```

### Sending from an external plugin

```ts
import { programmaticSend } from '~/composables/chat/useChatInputBridge';

const success = programmaticSend(activePaneId, '/imagine neon city at dusk');

if (!success) {
    console.warn('Pane not ready yet');
}
```

---

## Implementation notes

1. **Registry** — Maintains a `Ref<RegisteredPaneInput[]>`. Lookup happens through the helper `find(paneId)` to keep the public API concise.
2. **Updates** — Re-registering the same pane ID replaces the stored API so HMR or re-renders don’t stack duplicates.
3. **Error handling** — `programmaticSend` wraps calls in `try/catch`; errors log in dev mode and return `false` so callers can retry or surface UI feedback.
4. **Debug hook** — In dev, the registry is exposed on `globalThis.__or3ChatInputBridge` for console inspection.
5. **No storage** — Everything lives in memory; it only coordinates runtime components.

---

## Tips & gotchas

-   Always call `unregisterPaneInput` on unmount to keep the registry clean.
-   `programmaticSend` does nothing server-side; ensure it runs in the client.
-   Avoid invoking it before the pane finishes mounting—`hasPane` lets you guard against that.
-   Keep `paneId` stable per chat instance so automations target the right recipient.

---

## Related modules

-   `ChatInputDropper.vue` — actual UI input exposing the imperative API.
-   `pane-plugin-api` — typical consumer needing programmatic sends.
-   `useChat` — eventual destination for messages triggered through the bridge.
