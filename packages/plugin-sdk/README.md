# `@or3/plugin-sdk`

Stable Plugin Runtime V2 authoring contracts. Plugin packages import only this package (or its documented subpaths), never OR3 app aliases such as `~/`, `~~/`, `#imports`, or Nuxt auto-imports.

The default export surface provides:

- `defineOr3Plugin()` and Manifest V2 types
- a host-created, immutable-identity `PluginContext`
- scoped contribution and hook registration handles
- reviewed grant and feature-negotiation types
- mediated settings, storage, and HTTP clients with stable result/error types

The host owns context construction, plugin identity, generation, grants, cancellation, client scoping, and cleanup. Plugin-facing client calls never accept a plugin or workspace identity parameter.

Plugin packages can import `@or3/plugin-sdk/testing` for the local fake host. It supports activation, reviewed-grant denial, feature negotiation, one-shot service failures, stale generations, and cleanup/activation-failure assertions without importing OR3 application internals.
