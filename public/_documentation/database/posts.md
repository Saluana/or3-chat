# posts

Generic post storage built on the `posts` Dexie table; used for lightweight CMS data like release notes or docs.

---

## What does it do?

-   Validates posts with `PostCreateSchema`/`PostSchema` before persistence.
-   Normalizes optional `meta` payloads to JSON strings for compact storage.
-   Exposes CRUD helpers plus simple search utilities.
-   Integrates with hook filters/actions at every lifecycle step.

---

## Data shape

| Field      | Description                                                      |
| ---------- | ---------------------------------------------------------------- |
| `id`       | Primary key (auto-generated if omitted).                         |
| `title`    | Required, trimmed string.                                        |
| `content`  | Arbitrary string content (often Markdown).                       |
| `postType` | Logical discriminator (e.g., `'markdown'`, `'doc'`, `'prompt'`). |
| `meta`     | JSON string or structured object/array; normalized upstream.     |
| `deleted`  | Soft delete flag.                                                |

---

## API surface

| Function             | Description                                        |
| -------------------- | -------------------------------------------------- |
| `createPost(input)`  | Filters, normalizes meta/title, writes a new post. |
| `upsertPost(value)`  | Replaces an existing post with validation.         |
| `getPost(id)`        | Fetches a post by id with output filters.          |
| `allPosts()`         | Returns all posts (unfiltered); hook can prune.    |
| `searchPosts(term)`  | Case-insensitive title search using Dexie filter.  |
| `softDeletePost(id)` | Marks `deleted: true` and updates timestamp.       |
| `hardDeletePost(id)` | Removes the row entirely.                          |

---

## Hooks

-   `db.posts.create:filter:input` / `:action:(before|after)`
-   `db.posts.upsert:filter:input`
-   `db.posts.get/all/search:filter:output`
-   `db.posts.delete:action:(soft|hard):(before|after)`

---

## Usage tips

-   Use `postType` to segment content (e.g., `'doc'` and `'prompt'` reuse this table via other modules).
-   Normalize heavily structured `meta` objects before calling `createPost`; the helper will serialize for you but invalid JSON becomes `undefined`.
-   Hooks are the right place to inject slug generation or analytics side effects.
