# prompts

Prompt library built on the shared `posts` table (`postType: 'prompt'`) with TipTap JSON payloads.

---

## What does it do?

-   Adds CRUD helpers for saved prompt templates.
-   Normalizes titles (allowing empty strings when updating) and serializes content.
-   Reuses hook payload conventions (`DbCreatePayload`, `DbUpdatePayload`, `DbDeletePayload`).
-   Supports soft/hard delete flows plus a simple `ensureDbOpen` helper.

---

## Data structures

| Row            | Field             | Meaning                          |
| -------------- | ----------------- | -------------------------------- |
| `PromptRow`    | `content: string` | Raw JSON string stored in Dexie. |
|                | `postType`        | Always `'prompt'`.               |
|                | `deleted`         | Soft delete flag.                |
| `PromptRecord` | `content: any`    | Parsed JSON returned to callers. |

---

## API surface

| Function                  | Description                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------------- |
| `createPrompt(input?)`    | Generates an id, normalizes title/content, runs hooks, writes row, returns parsed record. |
| `getPrompt(id)`           | Loads a single prompt with output filters.                                                |
| `listPrompts(limit?)`     | Lists non-deleted prompts ordered by `updated_at` desc, capped to limit.                  |
| `updatePrompt(id, patch)` | Applies patches through hooks, persists, and returns updated record.                      |
| `softDeletePrompt(id)`    | Sets `deleted: true` and bumps `updated_at`.                                              |
| `hardDeletePrompt(id)`    | Deletes row from the posts table.                                                         |
| `ensureDbOpen()`          | Opens Dexie if closed.                                                                    |

---

## Hooks

-   `db.prompts.create:filter:input` / `:action:(before|after)`
-   `db.prompts.update:filter:input` (receives full payload context)
-   `db.prompts.list:filter:output`
-   `db.prompts.delete:action:(soft|hard):(before|after)`

---

## Usage tips

-   Leverage `normalizeTitle`’s `allowEmpty` option to let users save blank-titled prompts while still providing fallbacks.
-   Store structured prompt metadata inside hook filters instead of extending Dexie schema—`PromptEntity` supports custom fields.
-   Call `ensureDbOpen` before large migrations or offline flows to avoid lazy-open delays.
