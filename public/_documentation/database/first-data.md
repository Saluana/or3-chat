# Persist your first data

This tutorial is for a client-side feature in the OR3 source tree. A portable plugin should follow [the plugin tutorial](/documentation/plugins/first-plugin) instead.

We will save a small preference and a document using existing helpers. Those helpers own validation, timestamps, hooks, and persistence. No new table or database is needed.

## Save and read a preference

```ts
import { kv } from '~/db';

const preferenceName = 'example:reading-density';

export async function saveDensity(value: 'compact' | 'comfortable'): Promise<void> {
  await kv.set(preferenceName, value);
}

export async function readDensity(): Promise<'compact' | 'comfortable'> {
  const row = await kv.get(preferenceName);
  return row?.value === 'compact' ? 'compact' : 'comfortable';
}

export async function resetDensity(): Promise<void> {
  await kv.delete(preferenceName);
}
```

Call these from a client-side component lifecycle or user action. `kv.get` returns a row that can be missing; use its `value` and provide a default. For structured preferences, JSON-serialize on write and validate parsed data on read. A preference name is a convention, not an authorization boundary.

OpenRouter keys need their dedicated [persistence API](/documentation/auth/reference), which also updates reactive state and connection events. A generic KV write alone does not do that.

## Save an editable document

```ts
import { createDocument, getDocument, updateDocument } from '~/db/documents';

export async function createExampleNote(): Promise<string> {
  const document = await createDocument({
    title: 'Weekend ideas',
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Build something small.' }] }],
    },
  });
  return document.id;
}

export async function renameExampleNote(id: string): Promise<void> {
  const existing = await getDocument(id);
  if (!existing) throw new Error('Document not found');
  await updateDocument(id, { title: 'My weekend ideas' });
}
```

Documents live in `posts`, and the helper returns parsed TipTap content. There is no separate `documents` table. Use [posts](/documentation/database/posts) for custom record types and [prompts](/documentation/database/prompts) for saved system prompts.

## Verify the result

1. Save a density preference, read it back, and confirm the selected value.
2. Create a note and save its returned ID in your feature state or locate it in the document library.
3. Reload on the same origin and workspace. Read the preference and reopen the note.
4. Rename the note, then reopen it to confirm the persisted title.
5. Reset the example preference and confirm the fallback value.

Test any Cloud synchronization separately in a disposable workspace. A successful local write proves local persistence, not that another device has received it. For work that awaits a network request before saving, read [workspace-safe operations](/documentation/database/safe-changes#workspace-safe-operations) first.
