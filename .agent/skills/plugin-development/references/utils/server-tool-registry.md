# Server Tool Registry

`server/utils/chat/tool-registry.ts` provides the server-side tool registry used by background chat and background workflow execution.

It is intentionally separate from the client Vue registry.

## Purpose

- Register tool handlers on the server runtime
- Execute tools with JSON arg parsing + required-field checks
- Enforce runtime restrictions (`client` tools rejected on server)
- Enforce per-tool timeout

## Core API

```ts
registerServerTool(definition, handler, options?)
unregisterServerTool(name)
getServerTool(name)
listServerTools()
executeServerTool(toolName, argsJson)
```

### `registerServerTool`

Registers or replaces a server tool.

Options:

- `runtime?: 'hybrid' | 'client' | 'server'`
- `timeoutMs?: number` (default 10000)
- `override?: boolean`

Runtime defaults to `opts.runtime ?? definition.runtime ?? 'hybrid'`.

### `executeServerTool`

Returns:

```ts
{
  result: string | null;
  toolName: string;
  timedOut: boolean;
  error?: string;
  runtime?: ToolRuntime;
}
```

Behavior:

- Missing tool -> `error: Tool "..." is not registered on server.`
- `runtime === 'client'` -> rejected with client-only error
- Invalid JSON/required fields -> validation error
- Timeout -> `timedOut: true` with timeout error
- Success -> string `result`

## Registration Pattern

Register tools in Nitro plugins under `server/plugins/**`.

Example: `server/plugins/10.tool-registry.ts`

```ts
export default defineNitroPlugin(() => {
  registerServerTool(definition, async (args) => {
    // server-safe implementation
    return 'ok';
  }, { override: true });
});
```

This keeps SSR boundaries intact and avoids client imports in server code.

## Integration Points

- Background chat loop uses `executeServerTool(...)` in
  `server/utils/background-jobs/stream-handler.ts`.
- Background workflow adapter maps `listServerTools()` into workflow-core tool handlers in
  `server/utils/workflows/background-execution.ts`.

## Constraints

- Server-only module (no Vue refs/localStorage).
- Handlers must return strings.
- Tool name is the registry key; duplicate names require `override: true`.

## Related

- `public/_documentation/utils/tool-runtime.md`
- `public/_documentation/utils/tool-registry.md`
- `public/_documentation/utils/tools-public.md`
