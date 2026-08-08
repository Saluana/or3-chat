# Capability Guards

UI-level permission checks for actions exposed to plugins. Guards verify that the active plugin holds the required capability before an operation runs, and show a permission-denied toast when it does not.

Capability guards are how OR3 keeps plugin actions honest. Native app code is always allowed; a plugin that lacks a declared capability gets a clear denial instead of silent failure.

---

## Purpose

`capability-guards` provides:

- **Context-aware checks** — Operate on the currently active plugin
- **Three guard modes** — Single, all-of, or any-of capability checks
- **Clear feedback** — Denial shows a toast and logs an error with context tags
- **Safe defaults** — No active plugin context means the operation is allowed
- **Plugin context API** — Set and clear the active plugin from any caller

---

## Basic Example

```ts
import { guardCapability } from '~/utils/capability-guards';

// Inside a plugin action handler
if (!guardCapability('network:fetch', 'fetch remote data')) {
    return; // denied - toast already shown
}
```

---

## How to use it

### 1. Guard a single capability

```ts
import { guardCapability } from '~/utils/capability-guards';

function fetchRemoteData() {
    if (!guardCapability('network:fetch', 'fetch remote data')) {
        return;
    }
    // ... perform the operation
}
```

### 2. Require all capabilities

```ts
import { guardAllCapabilities } from '~/utils/capability-guards';

// Plugin must have BOTH capabilities
if (!guardAllCapabilities(['files:write', 'files:delete'], 'edit files')) {
    return;
}
```

### 3. Require any capability

```ts
import { guardAnyCapability } from '~/utils/capability-guards';

// Plugin must have AT LEAST ONE capability
if (!guardAnyCapability(['files:write', 'files:read'], 'open file panel')) {
    return;
}
```

### 4. Manage the active plugin context

```ts
import {
    setPluginContext,
    clearPluginContext,
    getActivePluginId,
} from '~/utils/capability-guards';

setPluginContext('my-plugin');      // Begin plugin-scoped work
console.log(getActivePluginId());   // 'my-plugin'
clearPluginContext();               // Return to native app context
```

---

## API Reference

### `guardCapability(capability, operation)`

Check that the active plugin has one required capability.

```ts
function guardCapability(capability: string, operation: string): boolean
```

Returns `true` when no plugin context is active, or when the plugin has the
capability. On denial it shows an error toast (`Permission Denied`) and
reports a silent `ERR_INTERNAL` error with tags for `domain: 'capabilities'`,
`pluginId`, `capability`, and `operation`.

### `guardAllCapabilities(capabilities, operation)`

Require the active plugin to have every listed capability. Stops at the first
failure.

```ts
function guardAllCapabilities(capabilities: string[], operation: string): boolean
```

### `guardAnyCapability(capabilities, operation)`

Require the active plugin to have at least one of the listed capabilities.

```ts
function guardAnyCapability(capabilities: string[], operation: string): boolean
```

### `setPluginContext(pluginId)`

Set the active plugin used by all guards. Pass `null` to clear.

```ts
function setPluginContext(pluginId: string | null): void
```

The context is stored on `globalThis` as `__or3ActivePluginContext`.

### `clearPluginContext()`

Clear the active plugin context.

```ts
function clearPluginContext(): void
```

### `getActivePluginId()`

Return the active plugin ID, or `null` when no plugin context is set.

```ts
function getActivePluginId(): string | null
```

---

## How it works

1. A pane plugin API or dashboard handler sets the active plugin context
2. Plugin code calls a guard before a restricted operation
3. The guard reads `globalThis.__or3ActivePluginContext.pluginId`
4. No plugin ID means the caller is native app code — allowed
5. A plugin ID is checked against its declared capabilities
6. Denial shows a toast, logs the failure, and returns `false`

---

## Important notes

- **UI-level only** — Guards are not security boundaries. Server-side checks
  still enforce real authorization.
- **Capabilities come from the dashboard** — Checks delegate to
  `hasCapability` / `hasAnyCapability` from `useDashboardPlugins`.
- **Toast is not optional** — Denials always surface to the user.
- **Context is global** — Remember to `clearPluginContext()` when plugin work
  finishes, or unrelated calls inherit the plugin's restrictions.

---

## Related

- `useDashboardPlugins` — Capability definitions and `hasCapability`
- `errors.ts` — Used for silent denial logging
- `plugin-access-gating.md` — Access control model for plugins

---

## TypeScript

```ts
function guardCapability(capability: string, operation: string): boolean;
function guardAllCapabilities(capabilities: string[], operation: string): boolean;
function guardAnyCapability(capabilities: string[], operation: string): boolean;
function setPluginContext(pluginId: string | null): void;
function clearPluginContext(): void;
function getActivePluginId(): string | null;
```

---

Document generated from `app/utils/capability-guards.ts` implementation.
