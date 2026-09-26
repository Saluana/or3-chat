# Unified plugin extraction tasks

## Phase 4 — Unhook core from Workflows and Agents

- [x] Drive the new-tab menu from registered pane contributions. Keep workflow creation and agent launcher behavior with their respective plugins.
- [x] Register Coding Workspace from the External Agents plugin, so it disappears when that registration is removed. Fall back from an active plugin profile after startup if its registration disappears.
- [x] Drive mobile navigation descriptions from registered sidebar pages. Show optional pages only while registered.
- [x] Keep theme tokens in core; no theme token extraction in this phase.
- [x] Treat `OR3_WORKFLOWS_ENABLED` as the Workflows plugin enable switch. Keep the editor, slash-command, and execution flags as options owned by that plugin until Phase 5.
- [x] Verify the changed test lane and targeted lint. The disabled-Workflows production bundle completed; its post-build check passed when invoked directly with Bun. The build wrapper returned an error afterward because its `tsx` subprocess could not open a sandbox pipe.

## Remaining

- [ ] Phase 5: move Workflows to `or3-plugin-workflows`, retain `workflow-entry` posts, and remove its core dependencies.
- [ ] Phase 6: move the External Agents UI and client to `or3-plugin-external-agents`, retain Connect's server runtime and vault compatibility, and remove the core client dependency.
- [ ] Phase 7: publish the authoring guide, pin versions, and verify builds and UI with each plugin installed and both absent.
