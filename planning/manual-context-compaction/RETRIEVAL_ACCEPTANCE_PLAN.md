# Retrieval and family acceptance owners

Source implementation and review remain separate from acceptance. These scenarios use the production registry, captured Dexie reader, central deletion APIs and actual sidebar. External inference alone is scripted. No fixture supplies its own scope resolver, search, ranking, cursor signing or deletion policy.

## Browser retrieval (5.1–5.4)

- Build T0 → T1 → T2 with the real controller/writer, plus an actual reference sibling. Resolve inherited and immediate landmarks through registered `get_message` in T2.
- Ask for sibling/foreign/unknown IDs, including expanded scope; return no foreign content. Verify adjacent neighbors cannot cross a captured or actual ancestor boundary.
- Insert later ancestor evidence; default lookup excludes it, explicit expansion labels it. Change a captured row clock/content and verify the changed flag. Delete it and verify deleted status with no bytes. Replace it with an eligible row and verify bounded replacement metadata.
- Search enough rows to cross 500-row and 1-MiB work boundaries. Verify deterministic bounded results, empty partial pages, continuation, signed cursor tampering, changed query/scope and ancestor revision rejection. Writes to the current T2 tool transcript must preserve an ancestor continuation.
- Cancel reads and switch workspaces while awaiting a real DB read. No result may be returned from a stale captured workspace. Exercise a separate connection's committed ancestor edit and revision propagation.
- Missing summary/anchor/recipe/message and cyclic lineage must return finite scope-incomplete. Legacy rows without an ordering key cannot silently vanish from a page.

## Providers and placement (5.5, 6.1–6.5)

Consume source-built SQLite and generated Convex artifacts against the exact host contract. Use materialized rows, not retained sync operations, with actual workspace/member checks. SQLite query plans/migration/revision triggers and authorized Convex transactions need their own owners. Test selected and absent capability, partial summary delivery, revoked membership, forged job/request actor, sibling IDs, browser bridge fallback, background reconnect and second-client reconciliation. Published compatible pins and live deployment qualification remain separate approval prerequisites.

## Families and deletion (7.1–7.5, 8.2)

Use both sidebar consumers with siblings, mixed documents, 10k threads, wrong/missing root hints, roots beyond the first page, cycles, matching children, project/pinned filters and independently paged members. Record actual grouping/refresh p95 and table reads; no message-content reads belong in the sidebar. Verify keyboard/mobile expansion and workspace preference reload. Group selection chooses recent activity; latest compaction selects its creation order. Central hard deletion must reject retained descendants before and after hooks, offer soft deletion, preserve summaries after source deletion and clean retired preferences only after the final usable member disappears.

## Recovery and visual gates (2.8, 2.11, 4.5–4.7, 8.1)

The named context harness owns initial provider rejection, same-ID reload recovery and once-only filtering. Additional owners must cover checkpoint failure, cancellation, changed source/tool/workspace, attachments and accepted tool-loop overflow. Capture the real PageShell sidebar expanded/collapsed, context details and composer/manual row-menu compaction in light/dark and mobile. Inspect every exported image before marking visual evidence accepted.
