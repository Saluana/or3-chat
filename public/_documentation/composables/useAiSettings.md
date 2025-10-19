# useAiSettings

Persistence layer for AI preference knobs. Keeps the chat experience consistent by storing master prompts and model defaults in browser storage, while exposing a clean interface for UI controls or automated scripts.

---

## Purpose

`useAiSettings` gives you a reactive settings object and helper methods to read, update, and reset AI chat preferences. It sanitises input, survives hot-module reloads, and only touches storage in the browser.

-   Tracks the current settings in a single global store (HMR-safe)
-   Loads initial values from `localStorage` once per session
-   Persists updates automatically
-   Normalises user input to avoid bad types or unknown keys

---

## Quick start

```ts
import { useAiSettings } from '~/composables/chat/useAiSettings';

const { settings, set } = useAiSettings();

watchEffect(() => {
    console.log('Current default mode:', settings.value.defaultModelMode);
});

set({ defaultModelMode: 'fixed', fixedModelId: 'anthropic/claude-3-sonnet' });
```

---

## API

| Property     | Type                                     | Purpose                                                                      |
| ------------ | ---------------------------------------- | ---------------------------------------------------------------------------- |
| `settings`   | `ComputedRef<AiSettingsV1>`              | Reactive snapshot of the current settings.                                   |
| `set(patch)` | `(patch: Partial<AiSettingsV1>) => void` | Merge in new values, sanitise them, persist to storage.                      |
| `reset()`    | `() => void`                             | Restore defaults and persist them.                                           |
| `load()`     | `() => AiSettingsV1`                     | Re-read from storage, update the reactive store, and return the fresh value. |

### `AiSettingsV1`

```ts
interface AiSettingsV1 {
    version: 1;
    masterSystemPrompt: string;
    defaultModelMode: 'lastSelected' | 'fixed';
    fixedModelId: string | null;
}
```

Defaults:

```ts
const DEFAULT_AI_SETTINGS: AiSettingsV1 = {
    version: 1,
    masterSystemPrompt: '',
    defaultModelMode: 'lastSelected',
    fixedModelId: null,
};
```

---

## How to use it

### Drive a settings form

```vue
<template>
    <form class="space-y-4" @submit.prevent="save">
        <label class="block">
            <span>Master system prompt</span>
            <textarea v-model="prompt" class="retro-input" rows="3" />
        </label>

        <label class="block">
            <span>Default model mode</span>
            <select v-model="mode" class="retro-input">
                <option value="lastSelected">Remember last model</option>
                <option value="fixed">Always use a specific model</option>
            </select>
        </label>

        <label v-if="mode === 'fixed'" class="block">
            <span>Model ID</span>
            <input v-model="modelId" class="retro-input" />
        </label>

        <button type="submit" class="retro-btn">Save</button>
    </form>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useAiSettings } from '~/composables/chat/useAiSettings';

const { settings, set } = useAiSettings();

const prompt = ref(settings.value.masterSystemPrompt);
const mode = ref(settings.value.defaultModelMode);
const modelId = ref(settings.value.fixedModelId ?? '');

watch(settings, (next) => {
    prompt.value = next.masterSystemPrompt;
    mode.value = next.defaultModelMode;
    modelId.value = next.fixedModelId ?? '';
});

function save() {
    set({
        masterSystemPrompt: prompt.value,
        defaultModelMode: mode.value,
        fixedModelId: mode.value === 'fixed' ? modelId.value || null : null,
    });
}
</script>
```

### Reset to defaults

```ts
const { reset } = useAiSettings();

reset();
```

### Hard refresh from storage

```ts
const { load } = useAiSettings();

const latest = load();
console.log('Reloaded settings', latest);
```

---

## Internal mechanics

1. **Singleton store**: A global object placed on `globalThis` survives HMR and ensures only one reactive store. The store holds `{ settings: Ref<AiSettingsV1>, loaded: boolean }`.
2. **Lazy hydration**: On first call in the browser, `loadFromStorage()` runs. Server contexts keep defaults because `window`/`document` are missing.
3. **Sanitisation**: `sanitizeAiSettings()` strips unknown keys, forces `defaultModelMode` to the allowed union, and normalises `fixedModelId`.
4. **Persistence**: `set` immediately writes to storage. A deep `watch` also saves direct mutations made outside of `set` for compatibility.
5. **Safety**: All storage access is wrapped in try/catch with console warnings in dev mode to avoid breaking the app when storage is unavailable.

---

## Edge cases & tips

-   **SSR**: Guarded by `isBrowser()` so storage isn’t touched during server rendering.
-   **Storage quota**: Failures fall back to logging a warning; settings stay in memory for the session.
-   **HMR**: Because the store lives on `globalThis`, you can tweak the composable without losing user-configured settings while the dev server is running.
-   **Direct mutations**: Prefer `set`, but the deep watch ensures manual changes like `settings.value.masterSystemPrompt = '...'` still persist.

---

## Related references

-   `useChat` — respects the defaults defined here.
-   `useAiSettingsPanel` (if present) — typical consumer for user-facing UI.
-   `AI_SETTINGS_STORAGE_KEY` — storage key constant if you need to inspect it manually.
