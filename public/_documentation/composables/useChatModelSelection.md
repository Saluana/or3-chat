# useChatModelSelection

Reactive controller for the model picker in a chat composer. It manages the selected model, web search, thinking mode, and reasoning effort for a single thread, and persists the last model choice.

## Purpose

`useChatModelSelection(options)` gives a chat input a consistent model-selection state:

-   `selectedModel` — the current model id (`Ref<string>`).
-   `webSearchEnabled` — web search toggle.
-   `thinkingEnabled` — extended thinking toggle.
-   `reasoningEffort` — reasoning effort level, kept in sync with the model.
-   `modelReasoningEfforts` — reasoning efforts the selected model supports.
-   `modelSupportsThinking` — whether the selected model supports thinking mode.

Behavior:

-   Hydrates the model catalog and favorites on mount.
-   Restores the last model from `localStorage` (`last_selected_model`).
-   Applies the fixed model from AI settings for new chats (no thread yet).
-   Listens for `or3:model-selected` window events so the catalog page can update the picker.
-   Calls `options.onChange(modelId)` whenever the model changes.
-   Disables thinking and resets reasoning effort for models that do not support them.

## Options

```ts
useChatModelSelection({
    threadId: () => threadIdRef.value, // getter for the current thread id
    onChange: (modelId) => persistModelChoice(modelId),
});
```

-   `threadId` — getter returning the active thread id (or `undefined` for a new chat).
-   `onChange` — callback invoked with the new model id after every change.

## Usage

```ts
import { useChatModelSelection } from '~/composables/chat/useChatModelSelection';

const { selectedModel, webSearchEnabled, thinkingEnabled, reasoningEffort } =
    useChatModelSelection({
        threadId: () => threadId.value,
        onChange: (modelId) => console.log('model', modelId),
    });
```

## Notes

-   The fallback model is `openai/gpt-oss-120b`.
-   The `:thinking` suffix is stripped when matching models against the catalog.

## Related

-   `useModelStore` — catalog and favorites source.
-   `useAiSettings` — fixed-model default source.
-   `ChatInputDropper.vue` — main consumer.
