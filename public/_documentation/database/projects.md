# Projects

Project metadata stays in the `projects` Dexie table. Persistent workspace policy reuses versioned internal `posts`; see [Work in a project](/documentation/start/projects).

Client navigation uses `useProjectSidebar()` from `~/composables/sidebar/useProjectSidebar`. Call it during setup and use `openProjectSidebar(id, from)` to select the project and activate `sidebar-projects-home`. `from` defaults to `'home'`; use `'projects'` for a selection from the list. `openProjectsSidebar()` clears the selection and opens the full list, including when the page is already active. The returned `projectId` and `returnTo` are UI navigation state and never set a chat's owning project. The project selection resets on workspace changes. Project navigation does not register a pane application or open workspace tabs.

Project activity reuses `SidebarTimeGroupedList` with `type="all"`, `projectId`, and an explicit `query` string. Omitting `query` retains the normal inherited sidebar search. Its optional `header` slot places the project summary in the same virtual scroll container as the activity rows; loading and empty messages stay below that header. Project document filtering includes both document associations and live document sources from Knowledge. Standard selection, rename, delete, and add-to-project events retain their existing sidebar handlers.

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
-   Project deletion removes policy/bindings and detaches chats atomically while retaining the underlying work. Hard deletion also purges internal project records.

## Persistent workspace records

`or3:project-settings`, `or3:project-memory`, and `or3:project-source` are hidden from ordinary document/search surfaces. Their title is the project ID; `[postType+title]` selects the project records. The singleton settings ID is `project-settings-<id>`. Content is strict version-1 JSON, with a 128 KiB record bound. The existing `or3.workspace-item` metadata capability marker protects these records from older sync clients.

`readProjectWorkspace(db, id)` validates settings, memories, and bindings. `saveProjectSettings`, `saveProjectMemory`, and `saveProjectSource` accept a captured `WorkspaceOperationScope` and expected clock. Stale writes, revoked access, invalid source identity, and foreign memory provenance refuse. Source `file_hashes` retains every original/extraction revision using existing reference accounting.

`resolveChatProject(db, threadId)` prefers `threads.project_id`, otherwise resolves a single legacy membership. Ambiguous ownership refuses. `moveChatToProject(scope, threadId, projectId | null)` updates the pointer and memberships atomically, retaining extension entries. `createThreadInDb` accepts an optional `assertCurrent` guard for captured callers.

The shared Project Context Builder captures ownership and project state before native admission. Tool execution and result delivery recheck scope; context receipts reside in assistant message metadata. `validateCompactionSummary` accepts an optional validated project receipt, which the fork writer preserves alongside the handoff.

Core membership entries support `chat`, `doc`, and `file`; legacy string entries
remain chat references. Known-entry edits preserve unrelated extension entries
and fields. Workspace assistant operations require an identified project and
its observed revision, validate current item visibility, and recheck inside the
write transaction. File members also require live original metadata. Logical
Trash hides memberships without removing the association, so Restore returns
the same grouping. Removing an association never deletes the underlying item.
