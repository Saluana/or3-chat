# Requirements

## Introduction

Give Projects and Files the same folder actions. Saving a folder or moving an item should use the ordinary workspace sync that OR3 Cloud already provides.

## Context

The explorer branch already has a project tree, a virtualized Files list, shared selection and drag handling, and a metadata-only content reader. It stores organization as special posts and checks an explorer capability in both the app and sync routes. OR3 already stores string-valued workspace metadata in an indexed Dexie `kv` table, syncs those rows, and includes the table in workspace archives.

## Assumptions

- The revision keeps the interactions from the existing explorer, including separate Files and project locations, Recent activity, touch selection, and explicit move destinations.
- The released app is the compatibility baseline. Someone testing the explorer branch may already have folders in the experimental post format.

## Out of Scope

Provider releases, production deployment, and a broader redesign of Files or Project Home are separate work.

## Requirements

### R1: Shared organization

**User Story:** As a workspace member, I want to organize the same item independently in Files and in a project.

**Acceptance Criteria**

- R1.AC1: WHEN I create, rename or move a folder, or move an item using drag, keyboard or the touch-accessible “Move to…” action, THEN both views SHALL use shared operations and name the destination scope.
- R1.AC2: WHEN I change an item's folder in one scope THEN its title, contents, project memberships and location in every other scope SHALL be preserved. Items without placement SHALL appear at the root of their eligible scope.
- R1.AC3: WHEN I choose “Remove folder, keep contents” THEN its direct contents SHALL appear at the nearest surviving parent, falling back to root. The UI SHALL name the destination and count affected entries before removing a nonempty folder.

### R2: Existing sync and access

**User Story:** As a Cloud user, I want folders to follow me across devices while older clients continue working.

**Acceptance Criteria**

- R2.AC1: WHEN an authorized user opens an eligible Projects or Files surface in the updated app THEN folders SHALL be available using the existing local or Cloud profile without an explorer setting, provider upgrade or capability negotiation.
- R2.AC2: WHEN a new client moves an item and a released older client renames that item and creates another THEN both edits SHALL sync on existing SQLite and Convex providers. A second new client SHALL resolve the moved item to the intended folder and the unplaced item to root.
- R2.AC3: IF the active workspace changes or the user has read-only access THEN an attempted move SHALL write zero organization rows. IF offline moves create a cycle or a missing parent THEN each client SHALL render a reachable item and accept a subsequent valid move.
- R2.AC4: WHEN a workspace backup containing folders is restored THEN nested paths, independent placements and content references SHALL resolve through the ordinary restore path.

### R3: Cost at workspace scale

**User Story:** As a user with many files, I want moving and browsing folders to remain responsive.

**Acceptance Criteria**

- R3.AC1: WHEN I move a single folder with descendants or a single item THEN the action SHALL write one organization record independent of subtree size.
- R3.AC2: WHEN browsing 5,000 content items, 500 folders and a 20-level chain in the production browser fixture THEN 30 warm navigation/selection interactions SHALL settle within 200 ms p95 with fewer than 150 mounted rows per viewport. Collapsing or expanding a loaded folder SHALL fetch zero document bodies or blobs.

### R4: Transition and documentation

**User Story:** As a tester, I want to keep the folders I already made and know how to enable the new UI.

**Acceptance Criteria**

- R4.AC1: IF experimental folder records exist in a supported upgrade fixture THEN the transition SHALL preserve nested paths and independent placements across reload and retry. IF the fixture contains synced experimental posts THEN its existing sync history SHALL also be tested before offering that upgrade.
- R4.AC2: WHEN reading the Files, Projects and Cloud guides THEN users SHALL be able to find folder actions, tell which location will change and identify the app update that enables folders.
