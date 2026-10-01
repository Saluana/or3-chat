# Hooks documentation

The maintained hook documentation lives in the public documentation category:

- [Overview](../public/_documentation/hooks/overview.md): actions, filters, async behavior, and engine boundaries.
- [First hook](../public/_documentation/hooks/first-hook.md): a complete source extension and cleanup.
- [API and types](../public/_documentation/hooks/reference.md): dispatch, lifecycle, declaration merging, and diagnostics.
- [Catalog](../public/_documentation/hooks/hook-catalog.md): payloads and emitted versus typed-only names.
- [Chat editor extensions](../public/_documentation/hooks/chat-editor-extensions.md): lazy TipTap integration.

Use [Plugin SDK](../public/_documentation/plugins/plugin-sdk.md) for installable packages. Application-private imports and host hook registration are not portable package APIs.

For source UI contributions, start with the [source contributor map](../public/_documentation/start/source-map.md#extend-source-ui-through-its-registry) and [source pane tutorial](../public/_documentation/start/mini-app-tutorial.md). Function contracts remain in the defining modules and JSDoc.
