# threads

Thread CRUD and query helpers with hook integration, branching support, and system prompt utilities.

---

## What does it do?

-   Creates and upserts thread rows with full schema validation.
-   Provides soft/hard delete flows that coordinate with message cleanup.
-   Offers search helpers and child-thread queries for branching UIs.
-   Implements a simple fork helper for cloning threads (optionally copying messages).
-   Stores per-thread system prompt references.

---

## Key fields

| Field                                | Description                                             |
| ------------------------------------ | ------------------------------------------------------- |
| `parent_thread_id`                   | Links branches back to their source thread.             |
| `anchor_message_id` / `anchor_index` | Track branching anchor points.                          |
| `branch_mode`                        | `'reference'` or `'copy'`; controls fork behavior.      |
| `forked`                             | Boolean flag marking branched threads.                  |
| `system_prompt_id`                   | Optional prompt reference stored with helper functions. |

---

## API surface

| Function                                       | Description                                                  |
| ---------------------------------------------- | ------------------------------------------------------------ |
| `createThread(input)`                          | Filters input, applies defaults, validates, persists thread. |
| `upsertThread(value)`                          | Validates and writes thread updates.                         |
| `threadsByProject(projectId)`                  | Returns threads scoped to a project (hook-filtered).         |
| `searchThreadsByTitle(term)`                   | Case-insensitive title filter using Dexie.                   |
| `getThread(id)`                                | Fetches a thread by id with output filters.                  |
| `childThreads(parentThreadId)`                 | Lists direct branch children.                                |
| `softDeleteThread(id)`                         | Marks deleted flag and updates timestamp inside transaction. |
| `hardDeleteThread(id)`                         | Deletes thread and cascades delete to messages.              |
| `forkThread(sourceId, overrides?, options?)`   | Clones thread metadata, optionally copies messages.          |
| `updateThreadSystemPrompt(threadId, promptId)` | Stores/clears prompt reference.                              |
| `getThreadSystemPrompt(threadId)`              | Reads stored prompt id (hook-filtered).                      |

---

## Hooks

-   `db.threads.create|upsert:filter:input` + before/after actions.
-   `db.threads.delete:action:(soft|hard)`
-   `db.threads.fork:action:(before|after)`
-   `db.threads.updateSystemPrompt:action:(before|after)`
-   Output filters for query helpers (`byProject`, `searchByTitle`, `get`, `children`, `getSystemPrompt`).

---

## Implementation notes

1. **Transactions** — Delete/fork flows run inside Dexie transactions touching both `threads` and `messages` to stay consistent.
2. **Forking** — New thread IDs generated via `newId()`. When copying messages the helper duplicates rows and optionally updates thread metadata timestamps.
3. **Search** — Title search uses Dexie filter; pair with Orama-based composables for better ranking when needed.

---

## Usage tips

-   Use `forkThread` (from this module) for quick clones, or the richer branching utilities in `app/db/branching.ts` when you need anchor-aware forks.
-   Always go through `updateThreadSystemPrompt` to change prompts so hooks and timestamps stay aligned.
-   When cleaning up, call `softDeleteThread` first so UI consumers can offer undo before executing destructive `hardDeleteThread`.
