# Hooks documentation

The maintained hook documentation lives in the public documentation category:

- [Overview](../public/_documentation/hooks/overview.md): actions, filters, async behavior, and engine boundaries.
- [First hook](../public/_documentation/hooks/first-hook.md): a complete source extension and cleanup.
- [API and types](../public/_documentation/hooks/reference.md): dispatch, lifecycle, declaration merging, and diagnostics.
- [Catalog](../public/_documentation/hooks/hook-catalog.md): payloads and emitted versus typed-only names.
- [Chat editor extensions](../public/_documentation/hooks/chat-editor-extensions.md): lazy TipTap integration.

Use [Plugin SDK](../public/_documentation/plugins/plugin-sdk.md) for installable packages. Application-private imports and host hook registration are not portable package APIs.

For UI contributions, use the dedicated composable references rather than a duplicated hook registry guide: [sidebar sections](../public/_documentation/composables/useSidebarSections.md), [header actions](../public/_documentation/composables/useHeaderActions.md), and [composer actions](../public/_documentation/composables/useComposerActions.md).
