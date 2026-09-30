# Unified plugin extraction tasks

## Phase 4 — Unhook core from Workflows and Agents

- [x] Drive the new-tab menu from registered pane contributions. Keep workflow creation and agent launcher behavior with their respective plugins.
- [x] Register Coding Workspace from the External Agents plugin, so it disappears when that registration is removed. Fall back from an active plugin profile after startup if its registration disappears.
- [x] Drive mobile navigation descriptions from registered sidebar pages. Show optional pages only while registered.
- [x] Keep theme tokens in core; no theme token extraction in this phase.
- [x] Treat `OR3_WORKFLOWS_ENABLED` as the Workflows plugin enable switch. Keep the editor, slash-command, and execution flags as options owned by that plugin until Phase 5.
- [x] Verify the changed test lane and targeted lint. The disabled-Workflows production bundle completed; its post-build check passed when invoked directly with Bun. The build wrapper returned an error afterward because its `tsx` subprocess could not open a sandbox pipe.

## Remaining

- [x] Phase 5 implementation: Workflows moved to `or3-plugin-workflows`; installed UI, background/HITL routes, saved `workflow-entry` posts and execution continuity, and disable/re-enable were tested. Core runtime dependencies were removed.
- [x] Phase 6 implementation: External Agents moved to `or3-plugin-external-agents`; Connect's server runtime, legacy KV/vault data, logout behavior, and installed UI disable/re-enable were tested. The core client dependency was removed.
- [ ] Phase 5/6 formal absent-plugin lint gate: the build, direct post-build check, typecheck, and import check pass, but repository-wide lint still fails in unchanged files. See the [authoritative checklist](../../../planning/unified-plugin-extraction/tasks.md) and [verification receipt](../../../planning/unified-plugin-extraction/phase-5-6-verification.md).
- [ ] Phase 7: the single authoring guide, fresh version pins, exact package checks, installed/absent builds, and installed/absent UI checks are complete. The repository-wide strict lint gate remains open. See the [authoritative checklist](../../../planning/unified-plugin-extraction/tasks.md) and [phase 7 receipt](../../../planning/unified-plugin-extraction/phase-7-verification.md).
