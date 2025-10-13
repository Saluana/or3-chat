# useProjectsCrud

Project CRUD toolkit that wraps Dexie helpers with validation, timestamping, and data normalisation for OR3 project records.

---

## What does it do?

`useProjectsCrud()` returns methods to create, rename, delete, and update projects:

-   `createProject` builds a new record with generated IDs, timestamps, and trimmed input.
-   `renameProject` validates titles and upserts updates.
-   `deleteProject` supports soft and hard delete flows.
-   `updateProjectEntries` replaces the project’s `data` array with normalised entries.
-   `syncProjectEntryTitle` propagates entry title/kind updates across every project reference.

Each helper uses the shared Dexie `db` instance under the hood.

---

## Basic Example

```ts
import { useProjectsCrud } from '~/composables/projects/useProjectsCrud';

const {
    createProject,
    renameProject,
    deleteProject,
    updateProjectEntries,
    syncProjectEntryTitle,
} = useProjectsCrud();

const projectId = await createProject({
    name: 'Design Sprint',
    description: 'Week-long challenge',
});

await renameProject(projectId, 'Design Sprint Q3');

await updateProjectEntries(projectId, [
    { id: 'doc-1', name: 'Brief', kind: 'doc' },
    { id: 'chat-8', name: 'AI brainstorm', kind: 'chat' },
]);

await deleteProject(projectId, { soft: true });
```

---

## How to use it

### 1. Instantiate once per setup

Call `const api = useProjectsCrud()` in composables or components. The returned methods are stateless and can be reused across calls.

### 2. Create projects

-   `createProject({ name, description?, id? })` trims input, generates defaults, and writes via `create.project`.
-   Returns the new project ID so you can navigate or open panes immediately.

### 3. Update metadata

-   `renameProject(id, name)` trims the new name and ensures the project exists before upserting.
-   `updateProjectEntries(id, entries)` clones the array before persisting to avoid mutating callers.

### 4. Delete projects

-   Soft delete (default) marks the record via `del.soft.project`.
-   Hard delete (`{ soft: false }`) removes it entirely via `del.hard.project`.

### 5. Sync linked entry titles

`syncProjectEntryTitle(entryId, kind, title)` iterates every project, normalises `data`, and updates matching entries—useful when a document/chat is renamed elsewhere.

---

## What you get back

`useProjectsCrud()` returns:

| Method                                        | Description                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------------- |
| `createProject(input)`                        | Creates a project; throws if name missing. Returns new ID.                            |
| `renameProject(id, name)`                     | Renames an existing project; throws if not found or name empty.                       |
| `deleteProject(id, options?)`                 | Soft or hard deletes a project.                                                       |
| `updateProjectEntries(id, entries)`           | Replaces the project’s `data` array after cloning entries.                            |
| `syncProjectEntryTitle(entryId, kind, title)` | Updates matching entry names across all projects; returns number of projects touched. |

---

## Under the hood

1. **Dexie helpers** – Calls `create.project`, `upsert.project`, `del.soft.project`, `del.hard.project`, and `db.projects.bulkPut`.
2. **Timestamps** – Uses `nowSec()` for `created_at`/`updated_at`, ensuring consistent epoch seconds throughout the app.
3. **ID generation** – Defaults to `newId()` when callers omit `id`.
4. **Normalisation** – Clones entry objects and relies on `normalizeProjectData` to accommodate legacy formats.
5. **Bulk updates** – `syncProjectEntryTitle` batches writes with `bulkPut` to minimise Dexie transactions.

---

## Edge cases & tips

-   **Empty names**: Helpers throw if the provided name is blank after trimming—handle errors in your UI.
-   **Missing project**: `renameProject` and `updateProjectEntries` throw when `db.projects.get` can’t find the ID.
-   **Concurrent edits**: `clock` isn’t mutated here; if you rely on CRDT syncs, adjust the payload before calling `upsert`.
-   **Entry kind**: `syncProjectEntryTitle` supplies `kind` when missing so downstream UIs can rely on it.
-   **Soft delete recovery**: Soft-deleted records still exist; build admin tooling to restore if required.

---

## Related

-   `useProjectTreeActions` — UI actions for projects and their entries.
-   `~/utils/projects/normalizeProjectData` — ensures project `data` arrays follow the latest schema.
-   `~/db/projects` — Dexie schema and helper exports referenced here.

---

## TypeScript

```ts
interface CreateProjectInput {
    name: string;
    description?: string | null;
    id?: string;
}

interface DeleteProjectOptions {
    soft?: boolean;
}

type ProjectEntry = {
    id: string;
    name: string;
    kind?: ProjectEntryKind;
    [key: string]: any;
};

function useProjectsCrud(): {
    createProject(input: CreateProjectInput): Promise<string>;
    renameProject(id: string, name: string): Promise<void>;
    deleteProject(id: string, options?: DeleteProjectOptions): Promise<void>;
    updateProjectEntries(id: string, entries: ProjectEntry[]): Promise<void>;
    syncProjectEntryTitle(
        entryId: string,
        kind: ProjectEntryKind,
        title: string
    ): Promise<number>;
};
```
