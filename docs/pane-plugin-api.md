# Pane Plugin API

Lightweight global API exposed in the browser (client only) to let external, retro-style plugins or quick scripts interact with open panes (chat + documents) without importing internal composables.

Global handle:

```ts
// Available after app mounted (dev + prod)
window.__or3PanePluginApi;
```

Type shape (simplified):

```ts
interface PanePluginApi {
    sendMessage(opts: {
        paneId: string;
        text: string;
        role?: 'user' | 'assistant';
        createIfMissing?: boolean;
        source: string;
    }): Promise<{ ok: true; messageId: string; threadId: string } | Err>;
    updateDocumentContent(opts: {
        paneId: string;
        content: unknown;
        source: string;
    }): Ok | Err;
    patchDocumentContent(opts: {
        paneId: string;
        patch: unknown;
        source: string;
    }): Ok | Err;
    setDocumentTitle(opts: {
        paneId: string;
        title: string;
        source: string;
    }): Ok | Err;
    getActivePaneData():
        | {
              ok: true;
              paneId: string;
              mode: string;
              threadId?: string;
              documentId?: string;
              contentSnapshot?: unknown;
          }
        | Err;
}
```

`source` is REQUIRED for every call. Use a short stable identifier for your plugin (e.g. `my-plugin`, `bookmarklet`, `ext:foo`). Calls without `source` are rejected.

---

## Accessing the API

```js
const api = window.__or3PanePluginApi;
if (!api) {
    console.warn('Pane plugin API not ready');
}
```

The plugin registers once. If you hot-reload in dev, the same instance is reused.

---

## Pane & Mode Requirements

| Method                | Pane Mode | Requires Thread? | Auto-create Thread?       | Requires Document?    |
| --------------------- | --------- | ---------------- | ------------------------- | --------------------- |
| sendMessage           | `chat`    | Yes              | If `createIfMissing:true` | No                    |
| updateDocumentContent | `doc`     | No               | N/A                       | Yes                   |
| patchDocumentContent  | `doc`     | No               | N/A                       | Yes                   |
| setDocumentTitle      | `doc`     | No               | N/A                       | Yes                   |
| getActivePaneData     | any       | N/A              | N/A                       | If active pane is doc |

If conditions are not met an error object is returned.

---

## Return Format

All methods return either:

```ts
{ ok: true, ...data }
// or
{ ok: false, code: string, message: string }
```

Check `ok` first.

---

## Error Codes

| Code             | Meaning                                                          |
| ---------------- | ---------------------------------------------------------------- |
| `missing_source` | `source` field omitted                                           |
| `missing_pane`   | No `paneId` provided                                             |
| `invalid_text`   | Empty / whitespace chat message                                  |
| `not_found`      | Pane ID not found in current layout                              |
| `pane_not_chat`  | Tried to send chat message to a non-chat pane                    |
| `pane_not_doc`   | Tried a doc operation on a non-doc pane                          |
| `no_thread`      | Chat pane has no thread and `createIfMissing` not set            |
| `no_thread_bind` | Internal inability to bind a new thread (multi-pane API missing) |
| `append_failed`  | DB append failed (Dexie / storage error)                         |
| `no_document`    | Doc operation requested but pane has no `documentId`             |

---

## Methods

### sendMessage

Inject a user (or assistant) message directly into the pane's thread.

```js
await api.sendMessage({
    paneId: 'pane-1',
    text: 'Hello from my plugin!',
    source: 'ext:demo',
    createIfMissing: true, // optional
});
```

Notes:

-   If the pane has no thread yet and `createIfMissing` is `true`, a new thread is created with a title derived from the first ~6 words of the message.
-   Emits hook: `ui.pane.thread:action:changed` (on new thread) and `ui.pane.msg:action:sent` after DB append.
-   Only persists a basic message payload (`content` string + empty attachments). Streaming is not triggered here.

### updateDocumentContent

Replace entire document content with a new value.

```js
api.updateDocumentContent({
    paneId: 'doc-pane-2',
    content: {
        type: 'doc',
        content: [{ type: 'paragraph', text: 'Full replace' }],
    },
    source: 'script:bulk-load',
});
```

-   Overwrites existing content reference.
-   Downstream save hooks / flush logic handle persistence as normal.

### patchDocumentContent

Apply a shallow patch with simple merge semantics:

-   If both existing + patch `content` are arrays, they are concatenated.
-   If only patch has `content` array, it replaces existing.
-   All other root keys (except `content`) are copied over.

```js
api.patchDocumentContent({
    paneId: 'doc-pane-2',
    patch: {
        content: [{ type: 'paragraph', text: 'Appended' }],
        lastEditedBy: 'ext:demo',
    },
    source: 'ext:demo',
});
```

### setDocumentTitle

```js
api.setDocumentTitle({
    paneId: 'doc-pane-2',
    title: 'My Updated Title',
    source: 'ext:demo',
});
```

### getActivePaneData

Returns current active pane lightweight metadata. For a doc pane includes a deep-cloned `contentSnapshot` (shallow JSON clone of `record.content`).

```js
const r = api.getActivePaneData();
if (r.ok) {
    console.log('Active pane:', r.paneId, r.mode, r.threadId || r.documentId);
    if (r.contentSnapshot) console.log('Doc snapshot', r.contentSnapshot);
} else {
    console.warn('No active pane', r.code);
}
```

---

## Hooks Emitted

| Hook                            | When                                                             |
| ------------------------------- | ---------------------------------------------------------------- |
| `ui.pane.thread:action:changed` | New thread created for a chat pane                               |
| `ui.pane.msg:action:sent`       | After a message is appended (sendMessage)                        |
| (Existing document save hooks)  | Triggered indirectly by store flush logic, not by the API itself |

Your plugin can listen via the global hook system if exposed (`$hooks`) or rely on UI updates.

---

## Best Practices

1. Always set a distinct `source` string (namespace collisions reduce traceability).
2. Debounce rapid document updates; bulk patch rather than many single-line calls.
3. Prefer `patchDocumentContent` when appending incremental segments to avoid clobber races.
4. For idempotent operations, maintain your own checksum/version outside (e.g. in KV or extension storage) before writing.
5. Avoid very large single `content` arrays; chunk and patch if needed (keeps diff + undo lighter).
6. Do not store secrets in documents or messages through this interface.

---

## Minimal Usage Snippets

Bookmarklet (chat message):

```js
javascript: (() => {
    const a = window.__or3PanePluginApi;
    if (!a) return alert('API not ready');
    a.sendMessage({
        paneId: prompt('Pane ID?'),
        text: 'Ping from bookmarklet',
        source: 'bm:ping',
        createIfMissing: true,
    });
})();
```

Bulk append 3 doc paragraphs:

```js
const a = __or3PanePluginApi;
const base = ['One', 'Two', 'Three'].map((t) => ({
    type: 'paragraph',
    text: t,
}));
base.forEach((p) =>
    a.patchDocumentContent({
        paneId: 'doc-pane-2',
        patch: { content: [p] },
        source: 'ext:bulk',
    })
);
```

---

## Limitations

-   No streaming / tool-call support (use internal chat flow for that).
-   Attachments array always empty for injected messages.
-   No automatic thread summarization; UI handles that asynchronously.
-   Document patch merge is intentionally shallow & simple.

---

## Debugging

Dev mode logs (guarded by `import.meta.dev`) appear with prefix `[pane-plugin-api]`.
If you do not see logs:

1. Confirm plugin init: `!!window.__or3PanePluginApi`.
2. Verify pane IDs (`__or3MultiPaneApi.panes.value.map(p=>p.id)`).
3. Check pane mode (`pane.mode`).
4. Inspect errors returned (log the whole object).

---

## Changelog

| Date       | Change                       |
| ---------- | ---------------------------- |
| 2025-09-06 | Initial public documentation |

---

## Future Improvements (Candidates)

-   Optional attachment injection.
-   Batched document patch method.
-   Read-only getters (list panes, fetch doc content snapshot) for safer introspection.
-   Optional streaming integration wrapper.

---

Questions or proposing an extension? Add notes in `planning/pane-plugin-api/` with a concise rationale + diff footprint estimate.
