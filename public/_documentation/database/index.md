# index

Barrel exports for the database layer, re-exporting the Dexie client, CRUD helpers, and common type aliases.

---

## What does it do?

-   Centralizes imports so callers can `import { create, queries, del } from '~/app/db'`.
-   Groups helpers into semantic objects: `create`, `upsert`, `queries`, `del`, `tx`, and `kv`.
-   Re-exports schema types (`Thread`, `Project`, `Document`, etc.) for consumer convenience.

---

## Aggregated namespaces

| Namespace  | Contents                                                                 |
| ---------- | ------------------------------------------------------------------------ |
| `create`   | `thread`, `message`, `kv`, `attachment`, `project`, `post`, `document`.  |
| `upsert`   | Sibling upsert helpers; note `document` maps to `updateDocument`.        |
| `queries`  | Read/query helpers spanning threads, messages, KV, posts, documents.     |
| `del.soft` | Soft-delete functions per entity.                                        |
| `del.hard` | Hard-delete counterparts (including KV helpers).                         |
| `tx`       | Transactional utilities (`appendMessage`, `moveMessage`, `copyMessage`). |
| `kv`       | Shorthand `get`, `set`, `delete` wrappers around name-based KV helpers.  |

---

## Usage example

```ts
import { create, queries, del } from '~/app/db';

const thread = await create.thread({ title: 'New chat' });
const messages = await queries.messagesByThread(thread.id);
await del.soft.thread(thread.id);
```

-   Prefer this barrel when wiring feature modules to keep import paths short and consistent.
