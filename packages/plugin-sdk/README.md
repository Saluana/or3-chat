# `@or3/plugin-sdk`

Stable Plugin Runtime V2 authoring contracts. Plugin packages import only this package (or its documented subpaths), never OR3 app aliases such as `~/`, `~~/`, `#imports`, or Nuxt auto-imports.

The default export surface provides:

- `defineOr3Plugin()` and Manifest V2 types
- a host-created, immutable-identity `PluginContext`
- scoped contribution and hook registration handles
- reviewed grant and feature-negotiation types

Settings, storage, and HTTP clients are introduced as mediated context capabilities in the next SDK task. The host owns context construction, plugin identity, generation, grants, cancellation, and cleanup.
