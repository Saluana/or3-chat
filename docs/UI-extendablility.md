# 🧩 UI Extendability Standards

This document defines how to build and maintain **extendable UI actions** in the app. It ensures every plugin and UI surface follows the same predictable pattern.

---

## 1. Core Principle

Every extendable UI surface should follow the same structure:

-   **Global registry** (on `globalThis`) → survives HMR.
-   **Reactive list** → Vue `computed` observes it.
-   **Register/unregister helpers** → plugin authors call `registerXxxAction`.
-   **Order-based sorting** → built-ins <200, plugins ≥200.
-   **Typed interface** → each registry defines its own interface.

---

## 2. Folder Structure

Each “extension point” gets its own folder under `composables/ui-extensions/`:

```
/ui-extensions/
  /message-actions/        # Already done
    useMessageActions.ts
    builtins/
      copy.ts
      retry.ts
  /toolbar-actions/        # e.g. top nav / main toolbar
    useToolbarActions.ts
    builtins/
      settings.ts
      profile.ts
  /pane-actions/           # e.g. per-pane UI buttons
    usePaneActions.ts
    builtins/
      close.ts
      split.ts
```

This makes it easy to know where to add new buttons.

---

## 3. Standard Interface

Every extension point uses a similar shape:

```ts
export interface UIAction {
    id: string; // unique id
    icon: string; // icon name
    tooltip: string; // hover text
    order?: number; // default 200
    showOn?: string | string[]; // optional filter (role, side, pane type)
    handler: (ctx: any) => void | Promise<void>;
}
```

### Context variations

-   **Message actions** → `showOn: 'user' | 'assistant' | 'both'`
-   **Toolbar actions** → `showOn: 'left' | 'right'`
-   **Pane actions** → `showOn: 'doc' | 'chat'`

---

## 4. Registry Template

Each `useXxxActions.ts` follows this template:

```ts
import { reactive, computed } from 'vue';

export interface ToolbarAction {
    id: string;
    icon: string;
    tooltip: string;
    order?: number;
    showOn?: 'left' | 'right';
    handler: (ctx: { app: any }) => void | Promise<void>;
}

const g: any = globalThis as any;
const registry: Map<string, ToolbarAction> =
    g.__or3ToolbarActionsRegistry ||
    (g.__or3ToolbarActionsRegistry = new Map());

const reactiveList = reactive<{ items: ToolbarAction[] }>({ items: [] });
function sync() {
    reactiveList.items = Array.from(registry.values());
}

export function registerToolbarAction(action: ToolbarAction) {
    registry.set(action.id, action);
    sync();
}

export function unregisterToolbarAction(id: string) {
    if (registry.delete(id)) sync();
}

export function useToolbarActions(side: 'left' | 'right') {
    return computed(() =>
        reactiveList.items
            .filter((a) => !a.showOn || a.showOn === side)
            .sort((a, b) => (a.order ?? 200) - (b.order ?? 200))
    );
}
```

---

## 5. Plugin Author Experience

To add a button, plugin authors import the `register*` function:

```ts
import { registerToolbarAction } from '~/ui-extensions/toolbar-actions';

export default defineNuxtPlugin(() => {
    registerToolbarAction({
        id: 'open-settings',
        icon: 'pixelarticons:settings',
        tooltip: 'Settings',
        showOn: 'right',
        order: 250,
        handler() {
            console.log('Open settings clicked!');
        },
    });
});
```

Exactly the same as message actions.

---

## 6. Built-in vs Plugin Actions

-   **Built-ins** → live in `/builtins/` inside each extension folder.
-   **Plugins** → live in their own plugin files.
-   Built-ins are **always rendered**, plugins come after via `order`.

This separation keeps “core UI” clear from plugin clutter.

---

## 7. Standards Cheat Sheet

-   One file per registry: `useXxxActions.ts`.
-   Global registry: stored on `globalThis`.
-   Reactive list: `reactiveList.items`.
-   Helpers: `registerXxxAction`, `unregisterXxxAction`, `useXxxActions`.
-   Order: built-ins <200, plugins ≥200.
-   Folder structure: `/ui-extensions/<surface>/`.
-   Plugin authors: always use `registerXxxAction` inside a Nuxt plugin.

---

## 8. Why This Works

-   Same mental model everywhere.
-   Plugins can extend any UI surface in the same way.
-   Built-ins stay hard-coded but can be overridden.
-   Clean separation of **UI surface** vs **extension points**.

---

✅ **Summary:**
Each UI surface (chat messages, toolbars, panes, etc.) has its own `useXxxActions.ts` registry. Built-ins live under `/builtins/`, plugins register via Nuxt plugins. Everything follows the same interface, order rules, and reactive registry pattern.
