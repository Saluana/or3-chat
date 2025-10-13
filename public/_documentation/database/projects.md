# projects

CRUD helpers for project metadata stored in the `projects` Dexie table.

---

## What does it do?

-   Validates incoming project objects with `ProjectSchema`.
-   Wraps persistence in `dbTry` for consistent error handling.
-   Emits hook actions/filters for create, upsert, delete, and read flows.

---

## Data shape

| Field                       | Description                                        |
| --------------------------- | -------------------------------------------------- |
| `id`                        | Project ID (string).                               |
| `name`                      | Display name.                                      |
| `description`               | Optional string (nullable).                        |
| `data`                      | Arbitrary JSON payload scoped to project features. |
| `clock`                     | Revision counter.                                  |
| `deleted`                   | Soft delete flag updated via `softDeleteProject`.  |
| `created_at` / `updated_at` | Unix seconds timestamps.                           |

---

## API surface

| Function                | Description                                       |
| ----------------------- | ------------------------------------------------- |
| `createProject(input)`  | Filters + validates + writes a new project.       |
| `upsertProject(value)`  | Filters + validates + replaces the row.           |
| `softDeleteProject(id)` | Marks project deleted within a Dexie transaction. |
| `hardDeleteProject(id)` | Removes the project entirely.                     |
| `getProject(id)`        | Reads a project by id and applies output filters. |

---

## Hooks

-   `db.projects.create:filter:input` / `:action:(before|after)`
-   `db.projects.upsert:filter:input`
-   `db.projects.delete:action:(soft|hard):(before|after)`
-   `db.projects.get:filter:output`

---

## Usage tips

-   Store structured per-project state inside `data`; use hooks to enforce schema or migrate old versions.
-   Soft delete keeps history for undo flows—run hard deletes during cleanup tasks only.
