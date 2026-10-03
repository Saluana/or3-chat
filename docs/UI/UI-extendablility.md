# Source UI extension conventions

The maintained registry inventory and registration example are in the
[Source contributor map](../../public/_documentation/start/source-map.md#extend-source-ui-through-its-registry).
Use [the SDK guide](../../public/_documentation/plugins/add-features.md)
for installable packages.

Reuse the existing typed registry for a surface, namespace contribution IDs,
and preserve its visibility, access, ordering, and lifecycle rules. Each
surface has its own contract; there is no universal `UIAction` interface or
`registerToolbarAction()` API. Do not copy a second `globalThis` registry.

Keep returned registration handles for owner-scoped disposal where available.
Some legacy helpers return void and require their matching unregister function;
verify that distinction in source before writing cleanup.
