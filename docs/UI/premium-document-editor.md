# Premium document editor architecture

The OR3 document editor is a local-first Tiptap surface split into four concerns:

- `DocumentEditorRoot.vue` owns the live editor, idle capture, responsive chrome, and lifecycle coordination.
- `useDocumentsStore.ts` owns generation-stamped persistence. A write can clear only the generations included in its snapshot, so edits made during an in-flight save remain dirty.
- `DocumentInspector.vue` hosts lazy history and plugin panels plus derived outline and document information. AI lives in a compact in-canvas composer so the document stays visible while prompting and reviewing edits.
- `document-revisions.ts` stores compressed, synced rolling history as internal posts.

## Theme contract

The editor root publishes the canonical `document` theme context and stable targets for its header, toolbar, canvas, AI composer, inspector, menus, and primary actions. Editor chrome resolves semantic `editor.*` icon tokens through `useIcon`, so installed themes can replace the complete icon language without patching components. Typography, colors, surfaces, outlines, and state colors consume generated theme tokens; Tiptap and floating surfaces are customized through each bundled theme's `documentsStyles` selectors.

All visible editor controls use Nuxt UI primitives: buttons, inputs, textareas, selects, searchable model selection, tabs, dropdown menus, badges, cards, sliders, form fields, and modals. Their shared configuration lives in the base app config and the bundled theme app-config patches. Raw DOM controls are reserved for Tiptap's editable surface and the visually hidden native file picker required for uploads.

The bundled `blank` profile supplies clean Tabler icons, soft borders, and elevated floating surfaces. The `retro` profile uses the default pixel icon language, theme border width/radius, and offset shadows. Both profiles support their light and dark palettes without editor-specific color constants; installed themes inherit safe defaults for any editor icon tokens they do not override.

## Persistence contract

The live editor is registered with `useDocumentEditorSessions`. Pane close and navigation capture the live Tiptap JSON before Dexie is flushed. Normal typing only marks the document dirty; canonical JSON is captured once after 750ms of inactivity. Outline and text statistics are recomputed at most once per animation frame and are never persisted.

Images use OR3 file hashes. The current document and every revision manifest retain referenced hashes so file garbage collection cannot remove a blob that history can still restore.

## Revision storage

Revision manifests use post type `or3:document-revision`; chunks use `or3:document-revision-chunk`. Both are excluded from normal post search and listing. Dexie v14 adds the `[postType+title]` index used to locate a document's manifests.

Snapshots are UTF-8 encoded in a lazy worker, gzip-compressed when `CompressionStream` is available, base64url encoded, and divided into chunks no larger than 48KiB. Every sync record is preflighted at 56KiB or less. A revision is visible only when every chunk is present and the SHA-256 hash of the reconstructed uncompressed snapshot matches its manifest.

Retention keeps the newest 20 complete checkpoints plus one per UTC day for the previous 14 days, then removes the oldest non-selected checkpoints until encoded history is at or below 5MiB per document. The newest complete checkpoint is always retained.

## Document AI safety model

AI runs only after explicit submission. The request freezes a selection, top-level section, or explicitly chosen document scope and assigns stable block references. The model must call the forced `propose_document_edits` tool with no more than 32 operations.

Operations are applied to the frozen snapshot off-screen. Unknown references, unsafe links, unsupported nodes, invalid nesting, oversized output, and schema-invalid content are rejected. The in-canvas composer previews an accept-all/reject-all candidate and shows the exact selected text when selection scope is available. Every editor transaction increments a content version; a proposal becomes unacceptably stale if the document changes before acceptance. Accepting creates a pre-AI checkpoint and applies the candidate as one editor transaction.

User settings are synced in `document_ai_settings.v1`, including the selected model, system instruction, and up to 12 quick actions. Only tool-capable models are listed.
