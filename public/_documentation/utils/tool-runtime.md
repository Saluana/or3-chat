# Tool Runtime Model (Client + Server)

OR3 tools use a shared runtime flag to control where a tool may execute:

```ts
type ToolRuntime = 'hybrid' | 'client' | 'server'
```

Defined in `app/utils/chat/types.ts`.

## Defaults

If runtime is omitted, registries treat the tool as `hybrid`.

- Client registry default: `opts.runtime ?? definition.runtime ?? 'hybrid'`
- Server registry default: `opts.runtime ?? definition.runtime ?? 'hybrid'`

This is the backward-compatible default for existing tools.

## Semantics

- `hybrid`
  - Intended to run in both foreground (client) and background (server) paths.
  - Register matching handlers in both registries when both paths are needed.

- `client`
  - Browser-only tool.
  - Native background chat delegates admitted calls to the originating browser through the client-tool bridge.
  - Calling it directly through the server registry is rejected; delegation does not make the handler server-safe.

- `server`
  - Server-only intent.
  - Register in `server/plugins/**` via `registerServerTool(...)`.
  - Provider-mediated client execution rejects it through the admission check.
    The legacy direct registry call does not enforce placement by itself.

## Execution Paths

### Foreground chat

Foreground tool calls use the client registry (`app/utils/chat/tool-registry.ts`).

### Background chat

The client starts the job with an admitted tool catalog. The server orchestrates
the turn, executes server/hybrid handlers through `executeServerTool(...)`, and
delegates client calls through the durable browser claim/result bridge. Execution
context captures the originating subject, workspace, thread and cancellation
signal; a tool's runtime flag does not grant access to either runtime's data.

The browser bridge must be available when a turn containing client tools starts.
The send path checks this capability before choosing background execution.
Background workflow execution has its own placement policy, described below.

### Background workflows

Workflow background execution builds tool handlers from `listServerTools()` and executes on server.

## Plugin Author Guidance

1. For tools that must work everywhere, use `runtime: 'hybrid'` and register both client and server handlers under the same tool name.
2. For browser-only features (DOM APIs, local browser context), use `runtime: 'client'`.
3. For server resources/secrets, use `runtime: 'server'` and register server-side only.
4. Keep parameter schemas identical across client/server handlers when sharing names.

## Related

- `public/_documentation/utils/tool-registry.md`
- `public/_documentation/utils/server-tool-registry.md`
- `public/_documentation/cloud/background-execution.md`
