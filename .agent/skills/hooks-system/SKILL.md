---
name: OR3 Hooks System
description: How to use the OR3 hooks system for actions, filters, and event-driven architecture
---

# Hooks System Skill

This skill covers the OR3 hook engine that powers actions, filters, and the sync integration.

---

## Architecture Overview

```
┌────────────────────────────────────────────────────────────────┐
│                     HookEngine (Core)                          │
│                 app/core/hooks/hooks.ts                        │
│    (addAction, addFilter, doAction, applyFilters, wildcards)   │
└───────────────────────────┬────────────────────────────────────┘
                            │
         ┌──────────────────┼──────────────────┐
         ▼                  ▼                  ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│  TypedHooks     │ │  useHooks()     │ │  HookBridge     │
│  Wrapper        │ │  Composable     │ │  (Sync Layer)   │
│  typed-hooks.ts │ │  useHooks.ts    │ │  hook-bridge.ts │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

---

## Key Files

| File | Purpose |
|------|---------|
| `app/core/hooks/hooks.ts` | Core engine (16KB) |
| `app/core/hooks/typed-hooks.ts` | Type-safe wrapper |
| `app/core/hooks/hook-keys.ts` | Known hook key definitions |
| `app/core/hooks/hook-types.ts` | Payload type maps (32KB) |
| `app/core/hooks/useHooks.ts` | Vue composable |
| `app/core/sync/hook-bridge.ts` | Dexie → sync integration |

---

## 1. Core Concepts

| Concept | Description |
|---------|-------------|
| **Action** | Side-effect listener, returns `void` or `Promise<void>` |
| **Filter** | Value transformer, returns modified value |
| **Priority** | Lower = runs first (default: `10`) |
| **Wildcards** | Use `*` to match patterns (e.g., `db.*.delete:action:after`) |

---

## 2. API Reference

### Actions (Fire-and-Forget)

```typescript
const hooks = useHooks();

// Register action
hooks.addAction('ai.chat.send:action:before', async (payload) => {
    console.log('About to send:', payload);
}, 10); // priority

// Trigger action
await hooks.doAction('ai.chat.send:action:before', { message: 'Hello' });

// Sync variant
hooks.doActionSync('ui.pane.active:action', { paneId: '123' });
```

### Filters (Transform Values)

```typescript
// Register filter
hooks.addFilter('ui.chat.message:filter:outgoing', (text, context) => {
    return text.toUpperCase(); // Transform the value
}, 10);

// Apply filter
const result = await hooks.applyFilters('ui.chat.message:filter:outgoing', 'hello', { threadId: '123' });
// result === 'HELLO'

// Sync variant
const syncResult = hooks.applyFiltersSync('sync.kv:blocklist', [...defaultList]);
```

### Ergonomic `on()` Wrapper

```typescript
// Auto-detects action vs filter based on hook name
const dispose = hooks.on('ai.chat.stream:action:delta', (chunk) => {
    console.log('Delta:', chunk);
}, { priority: 5 });

// Cleanup
dispose();

// Or use off()
hooks.off(dispose);
```

### One-Time Listeners

```typescript
const dispose = hooks.onceAction('sync.bootstrap:action:complete', () => {
    console.log('Bootstrap finished!');
});
```

---

## 3. Hook Naming Convention

```
<domain>.<entity>.<event>:<type>:<timing>
```

| Part | Examples |
|------|----------|
| Domain | `ai`, `ui`, `db`, `sync`, `files` |
| Entity | `chat`, `pane`, `messages`, `thread` |
| Event | `send`, `stream`, `delete`, `create` |
| Type | `action`, `filter` |
| Timing | `before`, `after`, `start`, `complete`, `error` |

### Examples
- `ai.chat.send:action:before` — Before sending AI message
- `ui.chat.message:filter:outgoing` — Transform outgoing message
- `db.messages.create:action:after` — After message created in DB
- `sync.bootstrap:action:complete` — Sync bootstrap finished

---

## 4. Known Hook Keys

Defined in `app/core/hooks/hook-keys.ts`:

### AI/Chat Hooks
```typescript
'ai.chat.send:action:before'
'ai.chat.send:action:after'
'ai.chat.stream:action:delta'
'ai.chat.stream:action:reasoning'
'ai.chat.stream:action:complete'
'ai.chat.stream:action:error'
'ai.chat.messages:filter:input'
'ai.chat.model:filter:select'
```

### UI/Pane Hooks
```typescript
'ui.pane.active:action'
'ui.pane.blur:action'
'ui.pane.switch:action'
'ui.pane.thread:filter:select'
'ui.pane.doc:action:saved'
```

### Sync Hooks
```typescript
'sync.bootstrap:action:start'
'sync.bootstrap:action:progress'
'sync.bootstrap:action:complete'
'sync.pull:action:received'
'sync.pull:action:applied'
'sync.push:action:before'
'sync.push:action:after'
'sync.op:action:captured'
'sync.error:action'
```

### DB Hooks (Template)
```typescript
`db.${table}.create:action:before`
`db.${table}.create:action:after`
`db.${table}.update:action:before`
`db.${table}.update:action:after`
`db.${table}.delete:action:before`
`db.${table}.delete:action:after`
```

---

## 5. Wildcards

Match multiple hooks with glob patterns:

```typescript
// Listen to all message-related DB events
hooks.addAction('db.messages.*', (event) => {
    console.log('Message event:', event);
});

// Listen to all sync errors
hooks.addAction('sync.*:action:error', (error) => {
    console.error('Sync error:', error);
});
```

---

## 6. HookBridge (Sync Integration)

The `HookBridge` automatically captures Dexie writes and queues them for sync.

### How It Works
```
Local Write → Dexie Hook → HookBridge.captureWrite() → pending_ops table
```

### Key Features
- **Atomic**: Uses Dexie transaction hooks
- **Suppression**: Ignores writes from sync layer (prevents loops)
- **Auto HLC**: Generates order keys for messages

### Usage
```typescript
import { getHookBridge } from '~/core/sync';

const bridge = getHookBridge(db);
bridge.start();  // Begin capturing
bridge.stop();   // Stop capturing

// Mark sync transaction (won't be captured)
bridge.markSyncTransaction(tx);
```

### Synced Tables
```typescript
const SYNCED_TABLES = ['threads', 'messages', 'projects', 'posts', 'kv', 'file_meta'];
```

---

## 7. Adding New Hooks

### Step 1: Define Hook Key (Optional)

Add to `app/core/hooks/hook-keys.ts`:
```typescript
export type KnownHookKey =
    // ... existing keys ...
    | 'my.feature:action:activated'
    | 'my.feature:filter:data';
```

### Step 2: Define Payload Types

Add to `app/core/hooks/hook-types.ts`:
```typescript
export interface HookPayloadMap {
    // ... existing entries ...
    'my.feature:action:activated': [{ featureId: string }];
    'my.feature:filter:data': [data: MyData, context: MyContext];
}
```

### Step 3: Use in Code

```typescript
const hooks = useHooks();

// Emit action
await hooks.doAction('my.feature:action:activated', { featureId: '123' });

// Apply filter
const result = await hooks.applyFilters('my.feature:filter:data', initialData, context);
```

---

## 8. Plugin Integration

```typescript
// app/plugins/my-plugin.client.ts
export default defineNuxtPlugin((nuxtApp) => {
    const hooks = useHooks();
    const disposers: (() => void)[] = [];

    // Register listeners
    disposers.push(
        hooks.on('ai.chat.stream:action:delta', (chunk) => {
            // Handle streaming chunk
        })
    );

    // HMR cleanup
    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            disposers.forEach(d => d());
        });
    }
});
```

---

## 9. Diagnostics

```typescript
const hooks = useHooks();

// Access diagnostics
const diag = hooks._engine._diagnostics;

// Timing data per hook
console.log(diag.timings['ai.chat.send:action:before']);

// Error counts
console.log(diag.errors['sync.push:action:after']);

// Current executing priority
const priority = hooks._engine.currentPriority();
```

---

## 10. Best Practices

| Practice | Details |
|----------|---------|
| **Always return from filters** | Returning `undefined` propagates as the value |
| **Use priorities wisely** | Lower = runs first; reserve 1-5 for critical hooks |
| **Clean up listeners** | Use `dispose()` or `off()` to prevent memory leaks |
| **Use `onceAction` for one-shots** | Analytics, onboarding, etc. |
| **Prefer typed hooks** | Use `useHooks()` for type safety |
| **Avoid sync in filters** | Filters should be fast; defer heavy work to actions |

---

## 11. Debugging

| Issue | Approach |
|-------|----------|
| Hook not firing | Check hook name spelling, verify `addAction`/`addFilter` called |
| Wrong execution order | Check priority values (lower = first) |
| Memory leak | Ensure cleanup in `import.meta.hot.dispose` |
| Slow hooks | Check `_diagnostics.timings` |
| Errors | Check `_diagnostics.errors` and console |
