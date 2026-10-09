# Chat tool execution in OR3 source

This guide is for contributors changing OR3's host-side chat tools. The client
Vue registry and the server registry are separate runtimes; a tool's `runtime`
field describes placement, not permission to read or change data.

## Choose the authoring surface

The `~/utils/chat/tools-public` import is an alias into OR3's `app/` source. Its
name means that the host module re-exports a convenient source API; it is not
the SDK entry point for an installable plugin. Portable plugins use the
permission-scoped chat tool methods in [`@or3/plugin-sdk`](/documentation/plugins/plugin-sdk#supported-operations)
and the [chat tool recipe](/documentation/plugins/add-features). Trusted-host
packages also use the SDK's qualified contribution surface. Do not ship
imports from `~/`, `~~/`, Nuxt aliases, or app implementation modules in a
plugin package.

In an OR3 source plugin, `defineTool()` validates a definition and gives its
handler a TypeScript argument type. This `.client.ts` example owns the exact
registration and disposes it with an active Vue scope when one exists, and on
HMR:

```ts
// app/plugins/example-tool.client.ts
import { defineNuxtPlugin } from '#app';
import { getCurrentScope, onScopeDispose } from 'vue';
import { defineTool, useToolRegistry } from '~/utils/chat/tools-public';

export default defineNuxtPlugin(() => {
    const definition = defineTool<{ query: string }>({
        type: 'function',
        function: {
            name: 'echo_query',
            description: 'Return a query string.',
            parameters: {
                type: 'object',
                properties: { query: { type: 'string', minLength: 1 } },
                required: ['query'],
                additionalProperties: false,
            },
        },
    });

    const handle = useToolRegistry().registerTool(
        definition,
        async ({ query }) => query,
        { runtime: 'client' },
    );

    const cleanup = () => handle.dispose();
    if (getCurrentScope()) onScopeDispose(cleanup);
    if (import.meta.hot) import.meta.hot.dispose(cleanup);
});
```

Handlers return strings; JSON-encode structured results. Both registries
validate definitions and arguments against the shared JSON Schema validator,
enforce byte limits on arguments/results, pass an `AbortSignal`, and apply a
10-second default timeout. The server registration can set its own
`timeoutMs`.

Parameter schemas use JSON Schema draft-07. Browser and server validation
interpret schemas without `eval` or `new Function`, so the production CSP
does not need `unsafe-eval`. Malformed schemas, unknown keywords and unresolved
references are rejected during registration. `format` remains an annotation;
use constraints such as `pattern` when a string format must be enforced.

## Runtime placement

`runtime` defaults to `hybrid` in each registry. Register matching definitions
and handlers in both runtimes only when the feature is safe and available in
both.

| Runtime | Foreground chat | Background chat |
| --- | --- | --- |
| `client` | Runs in the browser registry. | The server delegates an admitted call to the originating browser through the client-tool bridge when that background path is enabled. The server registry rejects direct client-only execution. |
| `server` | Provider-admitted client execution rejects it. | Runs through the server registry. |
| `hybrid` | Runs through a matching client registration. | Runs through a matching server registration. |

Foreground chat uses `useToolRegistry()` from `app/utils/chat/tool-registry.ts`.
The registry is a host singleton. User enablement is stored in browser
`localStorage` under `or3.tools.enabled`; it is a UI preference, not an
authorization record. The client registry exposes enabled definitions only,
and its optional `available({ workspaceId, threadId })` gate is checked both
when advertising a tool and immediately before execution.

Register server handlers with `registerServerTool()` from
`server/utils/chat/tool-registry.ts`, normally in a Nitro plugin under
`server/plugins/**`. This module has no Vue or browser storage dependencies.
Background workflows use the server registry with their separate
`workflowPolicy`; workflow placement is not inferred from chat placement.

## Admission, authority, and cleanup

Provider-visible calls carry an admission snapshot. The client checks that the
tool is still enabled, is not server-only, and still matches the admitted
definition. Server execution also checks the admitted definition and rejects
client-only registrations. Callers handling model output must use this admitted
path: the legacy direct client `executeTool(name, args)` call does not enforce
runtime placement by itself. Both admitted and legacy calls enforce global
enablement before execution and at guarded commit boundaries. Trusted Document
AI execution explicitly sets `ignoreGlobalEnabled` because it uses its own
run-specific `enabledTools`; omitting admission does not grant that override.
The server route validates the submitted
definitions and binds server/hybrid calls to the registered definition before
execution.

Admission and schema checks do not authorize a handler's data access. Handler
context can include subject, workspace, thread, message, call and request IDs,
plus an abort signal; absent values are null. Foreground client execution sets
`subject` to `null`, while server background execution supplies the authenticated
user ID. A client handler must not treat this context as server authorization;
check trusted identity and ownership wherever data is accessed. For
origin-bound work, capture the exact workspace/thread when the request starts,
recheck after awaits and before writes, and never retarget work using whichever
pane is focused later.

`registerTool()` returns a registration object with `dispose()`. That disposer
removes only the registration it created and returns `false` after replacement
or prior disposal, protecting a newer owner during HMR or plugin reload.
`registerServerTool()` returns the equivalent owner-bound disposer function.
Prefer those handles for cleanup; name-based unregister functions do not make
the same owner check.

## Source locations

- Client registry and shared types: `app/utils/chat/tool-registry.ts` and `app/utils/chat/types.ts`
- Convenience source exports: `app/utils/chat/tools-public.ts`
- Server registry: `server/utils/chat/tool-registry.ts`
- Source example: `app/plugins/examples/demo-calculator-tool.client.ts`
- Portable authoring: [SDK reference](/documentation/plugins/plugin-sdk), [first plugin](/documentation/plugins/first-plugin), and [feature recipes](/documentation/plugins/add-features)
- Background chat flow: [Background execution](/documentation/cloud/background-execution)
