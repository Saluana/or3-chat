# Saved prompts

Prompt library built on the shared `posts` table (`postType: 'prompt'`) with TipTap JSON payloads.

---

## What does it do?

-   Adds CRUD helpers for saved prompt templates.
-   Normalizes titles (allowing empty strings when updating) and serializes content.
-   Reuses hook payload conventions (`DbCreatePayload`, `DbUpdatePayload`, `DbDeletePayload`).
-   Supports soft/hard delete flows and stores tags/favorites in post meta.

---

## Data structures

| Row            | Field             | Meaning                          |
| -------------- | ----------------- | -------------------------------- |
| `PromptRow`    | `content: string` | Raw JSON string stored in Dexie. |
|                | `postType`        | Always `'prompt'`.               |
|                | `deleted`         | Soft delete flag.                |
| `PromptRecord` | `content: any`    | Parsed JSON returned to callers. |
|                | `tags` / `favorite` | Derived from meta; see `PromptMeta`. |
| `PromptMeta`   | `tags`, `favorite`| Shape stored in the post `meta` JSON. |

---

## API surface

| Function                  | Description                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------------- |
| `createPrompt(input?)`    | Generates an id, normalizes title/content, runs hooks, writes row, returns parsed record. |
| `getPrompt(id)`           | Loads a single prompt with output filters.                                                |
| `listPrompts(limit?)`     | Lists non-deleted prompts ordered by `updated_at` desc, capped to limit.                  |
| `updatePrompt(id, patch)` | Applies patches (title, content, tags, favorite) through hooks, persists, returns updated record. |
| `softDeletePrompt(id)`    | Sets `deleted: true` and bumps `updated_at`.                                              |
| `hardDeletePrompt(id)`    | Deletes row from the posts table.                                                         |

---

## Hooks

-   `db.prompts.create:filter:input` / `:action:(before|after)`
-   `db.prompts.get:filter:output`
-   `db.prompts.update:filter:input` (receives full payload context)
-   `db.prompts.list:filter:output`
-   `db.prompts.delete:action:(soft|hard):(before|after)`

## Default prompt preference

`useDefaultPrompt()` exposes the selected workspace's readonly `defaultPromptId`,
`ensureLoaded()`, `setDefaultPrompt(id)` and `clearDefaultPrompt()`. The preference
uses the existing KV key `default_system_prompt_id`; no schema or API change is
required. System Prompts Modal and Chat Settings consume this state.

Workspace switching clears the singleton cache and reloads the selected workspace.
An old read cannot replace that cache, even after switching away and returning.
Concurrent callers in one workspace generation share the pending load. A failed
current read returns `null` and a later load can retry.

Set and clear capture their originating DB before awaiting a load. An admitted
write may finish there after switching; it cannot change the destination's KV
preference. The cache and `chat.systemPrompt.default:action:update` hook report the
committed KV value, including input-filter transformations, after successful
persistence. Failed writes propagate without publishing an uncommitted value. A
write finishing in a previous workspace generation does not emit the UI update
hook; returning to its DB refreshes the current cache from its canonical row.

`getDefaultPromptId()` reads the DB captured at invocation directly. Callers that
continue asynchronously remain responsible for their own workspace lifetime.

The core System Prompts Modal closes when the workspace changes and clears its
visible library cache and pending confirmation/action selection. Reopen it to load
the selected workspace's library. A
captured list finishing after switching, closing or unmounting cannot publish
rows, selection or failure feedback, or clear the selected workspace's default.
Current-workspace loading still repairs a default that no longer exists in that
library. Refreshes admitted after closure perform no library read. Thread/pane
selection loading and leaving edit view also retain their modal/workspace
generation; an old continuation cannot replace a freshly opened context. These UI
guards do not define the lifetime of editor saves, mutation actions or caller
selection callbacks.

---

## Usage tips

-   Leverage `normalizeTitle`’s `allowEmpty` option to let users save blank-titled prompts while still providing fallbacks.
-   Store structured prompt metadata inside hook filters instead of extending Dexie schema—`PromptEntity` supports custom fields.
