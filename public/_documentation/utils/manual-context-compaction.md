# Manual context compaction

This guide describes the source implementation. Final runtime qualification and provider package rollout remain tracked in `planning/manual-context-compaction/tasks.md`.

The composer’s **Context** indicator estimates input occupancy against the selected model’s actual context window. Click it to inspect input, reply allowance and an optional maximum from AI settings. Attachment cost can be unknown. Unknown capacity is explicit and offers a model refresh; the application does not substitute a guessed capacity or silently trim history.

Choose **Compact** in the composer or **Compact conversation** in a conversation’s history menu. **Compact here** selects a specific eligible message boundary. Compaction is manual, uses the captured model, and creates a new conversation with a historical summary. The original remains saved. Pending generations/tools and short or inherited-only message scopes explain why the action is unavailable. Cancelling or changing the source prevents the operation from committing.

The new conversation begins with a collapsed **Context compacted** card. Expand it for the summary and landmarks. **View original** identifies the visible original message ordinal rather than an internal database index. Original and landmark links remain usable when the model cannot use retrieval tools. Reverse links at an original message open its direct branches.

The sidebar groups conversation families in one flat level. A collapsed family opens its latest matching activity; expanding it shows exact conversations labeled Original, Compacted, known Retry or Branch. Each row’s menu has **Go to original** and **Go to latest compaction**. Search can reveal matching children without changing saved expansion. Missing or cyclic lineage remains visible with an unavailable-link explanation. Grouping reads thread metadata, not conversation contents.

Hard deletion is refused while a retained child depends on the original. **Move to Trash** preserves that relationship. Historical retrieval never returns deleted text, and a missing original does not invalidate a saved summary.

If input and reply cannot fit, sending stops with `context_full`. Keep the draft, compact, edit it, or select another supported model. A locally blocked new request saves no new turn. An initial native rejection after local persistence keeps the saved turn; Retry can recover that same identity through its local checkpoint. Recovery repeats admission and does not repeat already-run request filters. A changed source or tool set requires explicit new preparation. Later tool-loop overflow preserves accepted results and stops before another provider request.

**Inspect lossy send** is a separate explicit recovery for a locally blocked new request. Inspect the exact old turns proposed for omission and confirm that one request. Saved history remains intact. Ordinary sends, retries, continuation and tool loops do not implicitly shorten normal user context.

## Extension and provider boundaries

Core `get_message` and `search_parent` tools derive authority from their captured execution context. Models cannot supply a workspace, actor or replacement thread. Default reads use captured compaction membership in the actual ancestor path. Explicit expansion stays within that path and labels content outside captured scope. Search returns bounded pages, signed continuation cursors, physical fetched-row and processed-byte counts, and an honest incomplete-scan status. An empty partial page does not establish absence: follow its continuation. Changed, replaced, deleted and unavailable originals have separate outcomes.

The optional sync gateway capability is `canonicalChatHistory: 'v1'`, with `readChatHistory(actor, query, signal)`. Queries are bounded by-ID or ordered thread pages; the host-only canonical seek protocol supports bounded neighbors. Thread queries return per-thread revisions. Materialized canonical rows are the content source; job records identify execution and retained sync logs are not content history. Existing providers remain valid without the capability.

Background admission resolves canonical readiness before freezing the tool catalog, and the server checks it again before creating a job. Unsupported or unsynced lineage uses the browser bridge or foreground path. A later gap returns `scope_incomplete`. Current membership and `can(workspace.read)` are checked through the existing authorization boundary.

`ai.chat.send:filter:prepare` and acknowledged real-ID `ai.chat.send:filter:commit` are additive request-scoped contracts. Legacy `ai.chat.send:action:before` and `ai.chat.messages:filter:before_send` retain their established once-only post-write order. Side-effecting legacy filters cannot provide universal zero-write final-payload admission until they adopt the pure contract. No transaction spans inference.

Local failed-native checkpoints use `chat_request_recoveries`, outside the synchronized table set. They contain the final payload and no credentials, bind source/turn/tool identities, and are removed on accepted generation or central thread deletion. SQLite migrations 022–023 and the Convex scaffold reader/revision changes require separately reviewed provider builds, round trips and released pins before rollout. D1 does not advertise the new canonical reader.
