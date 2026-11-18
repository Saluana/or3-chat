# Tasks

## 1. Confirm the upgrade paths

- [ ] 1.1 Identify the released app and provider pins, compare the branch-only explorer checks with the release, and prepare released and populated preview fixtures. Cover R2.AC1–2 and R4.AC1. Done when each fixture has recorded client/provider versions, item IDs and expected paths, with local-only and already-synced preview data distinguished.
- [ ] 1.2 Extend the existing explorer journeys with the mixed-client scenario and storage-independent UI outcomes before changing the persistence layer. Cover R1.AC1–3, R2.AC2–4 and R3.AC1. Done when the fixtures exercise the actual views and can detect a disappeared item, blocked old client, unauthorized move or subtree rewrite.

## 2. Deliver a local Files slice

- [ ] 2.1 Switch the organization store to scoped KV reads and the existing clocked write helpers. Retain workspace and membership checks and the tree projection. Cover R1.AC2–3, R2.AC3 and R3.AC1. Done when a folder with descendants moves with one organization write, and missing parents and concurrent cycles leave content reachable.
- [ ] 2.2 Connect the existing Files list, breadcrumbs and move actions. Cover R1.AC1–3 and R3.AC2. Done when a user can organize files with drag or the touch-accessible menu and see the same paths after reload.

## 3. Connect Projects and Cloud

- [ ] 3.1 Point Project Home at the same operations and enable both views through the ordinary surface permissions. Retire the branch-only explorer capability dependencies for normal workspaces. Cover R1.AC1–2 and R2.AC1–3. Done when a file can have distinct Files and project paths and Cloud editors and viewers get the appropriate actions with the existing providers.
- [ ] 3.2 Preserve detected preview organization using the transition described in the design. Cover R4.AC1. Done when repeat upgrades and interrupted retries preserve paths and newer edits, and the released baseline requires zero conversions.

## 4. Qualify and document

- [ ] 4.1 Run the mixed-client scenario for SQLite and Convex, plus backup/restore, offline reconnect and any historical preview pull/snapshot cases. Cover R2.AC1–4 and R4.AC1. Done when the existing provider packages pass and retained traces show continued ordinary sync and the expected folder paths.
- [ ] 4.2 Run the production explorer fixture, update the public Projects, Files and Cloud documentation and docmap, and reconcile any preview-only setup instructions in provider READMEs. Cover R1.AC1–3, R3.AC1–2 and R4.AC2. Done when the performance receipt records the stated thresholds, relevant tests and typechecks pass and the guides explain how users get the feature.

## Traceability Matrix

| Requirement | Design component | Tasks |
| --- | --- | --- |
| R1 | Organization store, tree projection, Projects and Files views | 1.2, 2.1, 2.2, 3.1, 4.2 |
| R2 | Organization store, tree projection, views, app availability | 1.1, 1.2, 2.1, 3.1, 4.1 |
| R3 | Organization store, tree projection, virtualized views | 1.2, 2.1, 2.2, 4.2 |
| R4 | App availability and transition, public guides | 1.1, 3.2, 4.1, 4.2 |

## Definition of Done

The accepted criteria pass against the released providers. The production performance run and mixed-client traces are reproducible, any populated preview fixture retains its paths, the docs describe activation, and the requirement matrix has complete coverage.
