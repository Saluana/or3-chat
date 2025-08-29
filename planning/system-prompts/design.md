# design.md

artifact_id: 6dd0af3b-67d1-4f9e-9b69-7a0d939dfc5c

## 1. Overview

Add lightweight System Prompts feature reusing existing documents persistence. Prompts are rows in `posts` table with `postType = 'prompt'`. A new modal (separate component) lists prompts, allows CRUD (create, rename, edit content through existing `DocumentEditor.vue`, soft delete) and selecting one active prompt for the current chat thread. Selection injects prompt content (TipTap JSON transformed to plain string) as system message at the top of the thread for subsequent model calls. Provide hook points similar to documents for extensibility. Simplicity: minimal new state, no new tables, small number of components.

## 2. Architecture

```
+-------------------+          +------------------+
| ChatInputDropper  |--select--> ActivePromptStore |--expose--> useActivePrompt()
|  (opens modal)    |          +------------------+
|                   |<--emit-- SystemPromptsModal |
+---------+---------+          |  list/edit CRUD  |
          |                     +---------+--------+
          | create/edit                   |
          v                               v
    DocumentEditor.vue              posts (IndexedDB) postType='prompt'
```

Sequence (Select):

1. User opens modal, clicks Select on a prompt.
2. Modal emits `select` with prompt record id.
3. ActivePromptStore sets activePromptId and resolves content.
4. Chat send logic prepends system message based on active prompt if set.

## 3. Components

### 3.1 `SystemPromptsModal.vue`

Responsibilities:

-   Fetch & list prompt records.
-   Provide buttons: Create, Clear Active, Close.
-   Actions per row: Select, Edit, Rename (inline), Delete.
-   When Edit: show `DocumentEditor` for the selected prompt in an editor pane (simple: replace list with editor + back button).
-   Emits: `selected(id)`, `closed()`.

State (local):

```
interface PromptListItem {
  id: string; title: string; updated_at: number; active: boolean;
}
```

### 3.2 `ActivePromptStore` (Composable) `useActivePrompt.ts`

Minimal reactive state.

```
interface ActivePromptState {
  activePromptId: Ref<string | null>;
  activePromptContent: Ref<any | null>; // TipTap JSON
}
```

API:

```
setActivePrompt(id: string | null): Promise<void>
getActivePromptContent(): any | null
clearActivePrompt(): void
```

On set: load prompt via shared API (new `getPrompt(id)` wrapper) then store content.
Hooks:

-   doAction `chat.systemPrompt.select:action:after` with { id, content }.

### 3.3 Persisted Prompt Operations

Reuse documents pattern by adding functions in `db/documents.ts` or a thin wrapper `db/prompts.ts` (preferred for clarity) that delegates to generalized helpers but with fixed `postType='prompt'`.
Functions:

```
createPrompt(input?: { title?: string; content?: any })
getPrompt(id: string)
listPrompts(limit=100)
updatePrompt(id: string, patch: { title?: string; content?: any })
softDeletePrompt(id: string)
```

Implementation can generalize existing code; simplest: copy `createDocument` etc changing constants.

### 3.4 Chat Integration

`useChatSend` (already exists) will check active prompt:

-   Import `useActivePrompt` and prepend a system message object if active.
    Pseudo:

```
const { activePromptContent } = useActivePrompt();
if(activePromptContent.value){
  messages.unshift({ role: 'system', content: richTextToString(activePromptContent.value) });
}
```

Conversion: minimal plain text join of paragraphs. Simple util `promptJsonToString(json)`.

## 4. Data Model

No schema changes; use existing `posts` Dexie table row shape.
Key row fields for prompt:

-   id (string)
-   title (string)
-   content (string JSON TipTap)
-   postType = 'prompt'
-   created_at / updated_at
-   deleted (boolean)

## 5. Interfaces / Types (TypeScript)

```
export interface PromptRecord { id: string; title: string; content: any; created_at: number; updated_at: number; deleted: boolean; }
```

Composable:

```
export function useActivePrompt(){
  const activePromptId = ref<string|null>(null);
  const activePromptContent = ref<any|null>(null);
  async function setActivePrompt(id: string|null){
    if(!id){ activePromptId.value=null; activePromptContent.value=null; return; }
    const rec = await getPrompt(id);
    if(rec){ activePromptId.value=rec.id; activePromptContent.value=rec.content; await hooks.doAction('chat.systemPrompt.select:action:after',{ id: rec.id, content: rec.content }); }
  }
  function clearActivePrompt(){ setActivePrompt(null); }
  return { activePromptId, activePromptContent, setActivePrompt, clearActivePrompt };
}
```

Utility conversion:

```
function promptJsonToString(json:any): string {
  if(!json || !json.content) return '';
  return json.content
    .filter((n:any)=>n.type==='paragraph')
    .map((p:any)=> (p.content||[]).map((c:any)=>c.text||'').join(''))
    .join('\n');
}
```

Good enough for MVP.

## 6. Hooks

Mirror document hook naming but with `prompts` namespace:

-   `db.prompts.create:filter:input`
-   `db.prompts.create:action:before/after`
-   `db.prompts.get:filter:output`
-   `db.prompts.list:filter:output`
-   `db.prompts.update:filter:input`
-   `db.prompts.update:action:before/after`
-   `db.prompts.delete:action:soft:before/after`
-   Selection: `chat.systemPrompt.select:action:after`

## 7. Error Handling

All CRUD functions return `undefined` on not found. UI displays simple toast / line error. Selection silently clears if deleted.
Edge cases:

-   Selecting prompt then it’s deleted: store clears on next fetch attempt.
-   Empty content: treated as blank system message (allowed).
-   Save conflicts: last write wins (local only).

## 8. Testing Strategy

Unit:

-   promptJsonToString conversion.
-   create/update/list prompts (Dexie mocked).
    Integration:
-   Set active prompt then send chat -> first message role system.
    Component (shallow):
-   Modal lists prompts and emits select.
    Manual QA: create, rename, edit, delete, select, clear.

## 9. Performance

Local only small N. No pagination required. O(n) list transform acceptable.

## 10. Simplicity Justification

Chose copy/wrapper approach over abstraction to avoid premature generalization. Reuses familiar patterns for quick implementation and low cognitive load.

## 11. Future (Not Now)

-   Search / filter prompts.
-   Share prompts across devices.
-   Tagging.
-   Rich formatting awareness in conversion.
