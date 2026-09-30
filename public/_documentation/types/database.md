# Database types

Database types describe either stored rows, helper inputs, or parsed records. Pick the contract at the layer where you are working; see [database overview](/documentation/database/overview) for persistence APIs.

## Where to import

| Source module | Contracts |
| --- | --- |
| `~/db/schema` | Project, Thread/ThreadCreate, Message/MessageCreate, Post/PostCreate, Kv/KvCreate, Attachment/AttachmentCreate, FileMeta/FileMetaCreate, Notification/NotificationCreate/NotificationAction, and their Zod schemas. |
| `~/db/documents` | DocumentRow, DocumentRecord, Document alias, CreateDocumentInput, UpdateDocumentPatch. |
| `~/db/prompts` | PromptRow, PromptRecord, PromptMeta and prompt helper inputs. |
| `~/db/client` | Or3DB and active database access. |
| `~~/types/database` | TipTapDocument/TipTapNode and record guards. |

The `~/db` barrel re-exports common types, but not every module contract. In that barrel, `Document` means the **parsed DocumentRecord**, not a raw posts row.

## Create input versus stored row

Schema-backed row types use `z.infer`; several create inputs use `z.input` so callers can omit fields supplied by defaults/transforms. Do not manufacture IDs, clocks, and timestamps just to satisfy a persisted row type when calling a create helper.

```ts
import { createThread } from '~/db/threads';
import type { Thread, ThreadCreate } from '~/db/schema';

export async function makeExampleThread(): Promise<Thread> {
  const input = { title: 'Example chat' } satisfies ThreadCreate;
  return createThread(input);
}
```

Full-row upserts differ from patch APIs. `upsertThread`/`upsertPost` receive rows; `updateDocument` receives an ID and patch. Use entity helpers to own validation and revision updates.

## Serialized versus parsed content

| Contract | Content representation |
| --- | --- |
| Post | Serialized content string; postType distinguishes documents, prompts, and custom records. Meta is stored as a string/null when present. |
| DocumentRow | Stored JSON string with postType doc. |
| DocumentRecord / Document | Parsed TipTap document or null. |
| PromptRow | Stored JSON string. |
| PromptRecord | Parsed content with prompt metadata exposed by the helper. |
| Message | Data is unknown and needs narrowing; file_hashes is a JSON-serialized array string. |

```ts
import type { Message } from '~/db/schema';
import { parseFileHashes } from '~/db/files-util';

export function attachedHashes(row: Message): string[] {
  return parseFileHashes(row.file_hashes);
}
```

Rows have snake_case fields such as `created_at`, `thread_id`, and `file_hashes`. Entity timestamps generally use Unix seconds. Sync/outbox scheduling contracts are separate and can use milliseconds.

## Local and wire fields

Entity revisions include clocks and, where supported, HLC/op IDs. Keep allocation and conflict rules in the persistence/sync helpers. Message ordering uses index plus order_key with stable tie breaking; do not assume index alone is globally unique.

`Post.document_reference_key` and `FileMeta.gallery_state` are local derived index fields. Writes recompute them and sync strips them. `FileMeta.ref_count` is derived file-reference state, not a synchronized last-write-wins counter. A type permitting these fields does not mean a caller should invent or trust their values.

For untrusted input use the [runtime schemas](/documentation/database/schema), not a TypeScript cast. Exact field lists and defaults live in `app/db/schema.ts`; document contracts live in `app/db/documents.ts`.
