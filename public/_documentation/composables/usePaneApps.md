# usePaneApps

Registry for custom pane applications in the multi-pane workspace. Plugins register a `PaneAppDef` and the workspace opens it as a pane with its own mode id.

## Purpose

`usePaneApps()` exposes four helpers:

-   `registerPaneApp(def)` — register or replace a pane app. Returns a `RegistrationHandle` that can remove it later. Definitions are validated against a Zod schema (id must be lowercase alphanumeric with hyphens; label required).
-   `unregisterPaneApp(id)` — remove an app by id.
-   `getPaneApp(id)` — look up a single app. Returns `undefined` when access policy blocks it.
-   `listPaneApps` — computed, sorted list of all registered apps (access-filtered).

## PaneAppDef

```ts
interface PaneAppDef {
    id: string; // used as the pane mode when opened
    label: string;
    icon?: string;
    component: Component | (() => Promise<Component>);
    postType?: string; // defaults to app id
    createInitialRecord?: (ctx) => Promise<{ id: string } | null>;
    order?: number; // defaults to 200
    pluginId?: string;
    access?: PluginGatePolicy;
    replaceRecordInCurrentTab?: boolean;
}
```

## Usage

```ts
import { usePaneApps } from '~/composables/core/usePaneApps';

const { registerPaneApp, listPaneApps } = usePaneApps();

const handle = registerPaneApp({
    id: 'snake-game',
    label: 'Snake Game',
    icon: 'i-ph-game-controller',
    component: () => import('~/components/apps/SnakeGame.vue'),
});

// Later, open it from multi-pane:
await multiPane.newPaneForApp('snake-game');
```

## Notes

-   Access policies are enforced at read time; blocked apps never appear in `listPaneApps`.
-   Registrations survive HMR through the shared registry.

## Related

-   `useMultiPane` — `newPaneForApp` / `setPaneApp` open registered apps.
-   `usePanePrompt` — per-pane prompt staging for chat panes.
