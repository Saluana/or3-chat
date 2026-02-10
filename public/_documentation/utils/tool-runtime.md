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
  - Background server execution skips/rejects it with a clear error.

- `server`
  - Server-only intent.
  - Register in `server/plugins/**` via `registerServerTool(...)`.

## Execution Paths

### Foreground chat

Foreground tool calls use the client registry (`app/utils/chat/tool-registry.ts`).

### Background chat

Client starts the job with enabled tool definitions and optional `_toolRuntime` hints.
Server executes calls through `executeServerTool(...)`.
Client-only tools are surfaced as `skipped/error` states in `tool_calls` metadata.

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
