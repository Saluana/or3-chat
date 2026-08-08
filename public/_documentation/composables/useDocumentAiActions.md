# useDocumentAiActions

Registry for Document AI prompt commands. Plugins contribute `/` commands shown in the Document AI composer.

## Purpose

-   `registerDocumentAiAction(action)` — add or replace a command.
-   `unregisterDocumentAiAction(id)` — remove a command.
-   `useDocumentAiActions()` — computed, sorted, access-filtered list of commands.

`DocumentAiAction`:

```ts
{
    id: string;
    label: string;
    prompt: string;          // inserted into the composer
    icon?: string;
    defaultScope?: 'selection' | 'section' | 'document';
    order?: number;          // default 200
    pluginId?: string;
    access?: PluginGatePolicy;
}
```

## Usage

```ts
import { registerDocumentAiAction } from '~/composables/editor/useDocumentAiActions';

registerDocumentAiAction({
    id: 'my-plugin:summarize',
    label: 'Summarize section',
    prompt: 'Summarize the selected content in three bullet points.',
    defaultScope: 'selection',
});
```

## Notes

-   Selecting a command inserts its prompt without sending; edit context is resolved at send time.

## Related

-   `useDocumentAiAgent` — the composer that consumes these commands.
-   `useDocumentAiSettings` — agent preferences.
