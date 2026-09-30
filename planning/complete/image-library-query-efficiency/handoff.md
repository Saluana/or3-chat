Implement the image-library query efficiency fix in `/Users/brendon/Documents/or3/or3-chat`.

Read applicable AGENTS.md instructions, then `public/_documentation/docmap.json` and the relevant mapped docs. Follow `planning/image-library-query-efficiency/{requirements,design,tasks}.md`; mark tasks complete as you verify them. This plan was grounded in branch `or3-cloud`, commit `db8c35fee38dfeee304175cacf0e333e16ad69a3`. Recheck current source and preserve unrelated work.

Problem: `app/pages/images/index.vue` calls `listAllImageMetas(false)`, `listAllImageMetas(true)`, and `listDocuments(Number.MAX_SAFE_INTEGER)`. It parses all active document bodies, builds full-library arrays/search, and only then slices 50 visible images. Fix screenshot finding 6; sidebar pagination from the partially visible finding 7 is outside this task.

Implement two coherent milestones:

1. Add a real reference-only document read path.
   - Reuse persisted `posts.file_hashes` and `parseDocumentFileHashes`; use only active `postType === 'doc'` rows and deduplicate hashes.
   - A return-value projection over `posts` still reads the bodies. Use the plan's sparse local `document_reference_key` index, maintained at the Dexie write boundary, so gallery reference queries read index keys without fetching post values or parsing content.
   - Leave `listDocuments`, `getDocument`, their full-content return types, and their output-hook contracts unchanged. The new helper represents persisted references; do not pass partial records through full-document hooks or repair missing hashes by parsing bodies on gallery open.

2. Move gallery paging into the data layer and keep global work separate.
   - Add the planned local image eligibility/state field and ordered/covering indexes. Use the next unused Dexie version, currently after v15.
   - Read timestamp/size pages with exclusive `(sortValue, hash)` cursors; retrieve up to 51 matching IDs and hydrate only the 50 display records. Preserve `created_at` ordering, verified raster/legacy-kind rules, all views, and generated-name classification.
   - Read compact summary index keys for global counts, name ordering, and search. Preserve locale-aware name sorting through a versioned compact-ID ordering; do not assume IndexedDB string order matches `localeCompare`.
   - Render the default first page without awaiting document references, global aggregates, or Orama. Show pending/failed aggregate states distinctly from zero.
   - Adapt existing `useImageSearch`/Orama helpers to summaries. Search the whole corpus, retrieve matching IDs in batches of at most 200 using the existing offset option, and preserve the whole-corpus substring fallback. Results after image 50 and after match 200 must remain searchable/pageable. Category counts are global; matching totals cover the full active view.

Correctness requirements:

- Keep derived fields local and strip them through existing sync sanitization. Derive them atomically on every relevant write, including bulk writes, remote sync, snapshots, and backup restore, regardless of sync-capture suppression. Test rollback and migration without changing source clocks/data or adding outbox operations. Avoid separate reference tables, provider API changes, new dependencies, or a generalized indexing framework.
- Use `getDb()`, existing Dexie subscription patterns, and `subscribeActiveWorkspaceDb`. Invalidate on same-count edits; reset cursors for changed view/sort/query/data; reject stale async results. Immediately clear old-workspace pages, selection, viewer, and search state. Dispose timers/subscriptions.
- Preserve upload, rename, Select all visible, restore, soft/hard delete, direct command-palette opening of an unloaded hash, and lazy grid/viewer previews. Mutation success must come from the operation result, not whether the affected hash was loaded on screen.
- Report query failures with existing error conventions and support retry. Do not silently turn failures into empty lists/counts.

Verify with production-backed tests and real Dexie/fake IndexedDB for index/migration behavior; existing `files-select.test.ts` mocks alone are insufficient. Cover large/malformed document bodies, reference edge cases, duplicate sort keys, every view/sort, >200 search hits, accurate global counts, same-count edits, workspace/request races, sync/restore, and destructive actions. Measure baseline/candidate on the same disposable fixture: after migration, opening the library must perform zero document-value reads/body parses and at most 51 full image metadata reads. Global compact-key scans remain O(N); report them honestly and measure migration separately.

Use Bun. Run all affected DB/migration, gallery/search, sync, backup, and preview/action regression tests, followed by one typecheck and relevant browser smoke. Update mapped public database/API documentation and docmap, validate docs, simplify, and inspect the final diff. Do not publish, deploy, or change unrelated sidebar code. Finish with changed files, verification results, measurements, and any remaining limitations.
