# Admin Settings Integration - Implementation Plan

## Overview

This plan addresses critical issues where system settings (feature flags) are not properly integrated throughout the application. When features are disabled via admin settings, UI elements should be hidden/disabled immediately (or after reload where appropriate).

## Philosophy

Following the project's emphasis on **simplicity and avoiding over-engineering**, this plan focuses on:

1. **Minimal Changes**: Only touch files that have bugs or missing feature checks
2. **Consistent Patterns**: Use existing patterns (like documents plugin) as templates
3. **No Over-Engineering**: Accept that config changes require reload rather than building complex reactive systems
4. **Clear Documentation**: Make expectations clear to users about when reloads are needed

## Priority: High (Blocker)

The main reported issue - workflows still showing when disabled - is a **user-facing bug** that undermines the admin dashboard's purpose.

## Implementation Tasks

### Phase 1: Fix Workflow Message Rendering (Blocker)

**Goal**: Ensure workflow messages are hidden when `workflows.enabled` is false.

#### Task 1.1: Add Feature Check to ChatMessage.vue
- [ ] Add `useOr3Config` import to `app/components/chat/ChatMessage.vue`
- [ ] Create computed `workflowsEnabled` property
- [ ] Update `v-if` condition for `WorkflowChatMessage` to include feature check
- [ ] Test: Verify workflow messages don't render when disabled

**Files Changed**: 
- `app/components/chat/ChatMessage.vue`

**Estimated Lines Changed**: ~5 lines added

---

#### Task 1.2: Fix mergeWorkflowState in ChatContainer.vue
- [ ] Add `useOr3Config` import to `app/components/chat/ChatContainer.vue`
- [ ] Create computed `workflowsEnabled` property  
- [ ] Add early return in `mergeWorkflowState()` when workflows disabled
- [ ] Test: Verify workflow state is not merged when disabled

**Files Changed**:
- `app/components/chat/ChatContainer.vue`

**Estimated Lines Changed**: ~8 lines added

---

### Phase 2: Fix Workflow Editor Sub-Flag (High)

**Goal**: Respect `workflows.editor` setting - allow viewing workflows but disable editor.

#### Task 2.1: Split Pane Registration in workflows.client.ts
- [ ] Wrap `registerPaneApp()` call in `if (or3Config.features.workflows.editor)` check
- [ ] Keep sidebar page registration outside the check (always show when workflows enabled)
- [ ] Update error log message from `[snake-game]` to `[workflows]`
- [ ] Test: Verify pane app not registered when editor disabled

**Files Changed**:
- `app/plugins/workflows.client.ts`

**Estimated Lines Changed**: ~3 lines modified, indent changes

---

### Phase 3: Add User Documentation (Medium)

**Goal**: Set clear expectations that config changes require reload.

#### Task 3.1: Add Info Banner to System Settings Page
- [ ] Add info banner to `app/pages/admin/system.vue` in the Configuration section
- [ ] Use neutral styling (not warning/error) 
- [ ] Message: "Feature flag changes require a page reload to take full effect."
- [ ] Position: Above the configuration groups, below the status cards

**Files Changed**:
- `app/pages/admin/system.vue`

**Estimated Lines Changed**: ~8 lines added

---

### Phase 4: Verify Other Features (Low)

**Goal**: Ensure other features (documents, mentions, backup) are properly gated.

#### Task 4.1: Audit Documents Feature
- [ ] Review `sidebar-home-page.client.ts` - **ALREADY CORRECT** ✅
- [ ] Check for any document-related components that might leak
- [ ] Test: Disable documents, verify no UI elements show

**Files to Review**:
- `app/plugins/sidebar-home-page.client.ts` (already correct)
- `app/components/sidebar/SidebarDocsPage.vue`

**Expected Result**: No changes needed, documents already properly gated.

---

#### Task 4.2: Audit Mentions Feature
- [ ] Review `mentions.client.ts` plugin registration
- [ ] Check if mentions are properly disabled in editor when flag is off
- [ ] Move mention CSS from global scope to plugin (optional cleanup)
- [ ] Test: Disable mentions, verify no suggestions appear

**Files to Review**:
- `app/plugins/mentions.client.ts`
- TipTap editor configuration

**Expected Changes**: Likely none required for core functionality, possible CSS cleanup.

---

#### Task 4.3: Audit Backup Feature
- [ ] Check where backup feature is used in UI
- [ ] Verify backup actions are hidden when disabled
- [ ] Test: Disable backup, verify no backup UI elements

**Files to Review**:
- Search for `features.backup.enabled` references

**Expected Changes**: Minimal or none.

---

#### Task 4.4: Audit Dashboard Feature
- [ ] Check if dashboard feature flag controls anything
- [ ] Document what it's intended to control
- [ ] Implement gating if missing

**Files to Review**:
- Search for `features.dashboard.enabled` references

**Expected Changes**: TBD based on findings.

---

### Phase 5: Testing (Critical)

#### Task 5.1: Add Unit Tests
- [ ] Test: ChatMessage hides WorkflowChatMessage when workflows disabled
- [ ] Test: ChatContainer doesn't merge workflow state when disabled
- [ ] Test: Pane app not registered when editor sub-flag is false
- [ ] Run: `bun test app/components/chat`
- [ ] Run: `bun test app/plugins`

**New Test Files**:
- Tests added to existing `__tests__` directories

**Estimated Lines**: ~50-100 lines of test code

---

#### Task 5.2: Manual Integration Testing
- [ ] Test Scenario 1: Disable workflows in `config.or3.ts`, reload, verify no workflow UI
- [ ] Test Scenario 2: Enable workflows but disable editor, verify sidebar shows but pane doesn't
- [ ] Test Scenario 3: Disable documents, verify no docs tab in sidebar
- [ ] Test Scenario 4: Disable mentions, verify no @ suggestions in chat input
- [ ] Test Scenario 5: Re-enable features, verify they work correctly

**Testing Matrix**:

| Feature | Disabled | Expected Behavior |
|---------|----------|-------------------|
| workflows.enabled | false | No workflow messages, no sidebar tab, no pane app |
| workflows.editor | false | Sidebar tab shows, pane app hidden, no editing |
| workflows.slashCommands | false | No `/workflow` commands in autocomplete |
| workflows.execution | false | Workflow messages show but don't execute |
| documents.enabled | false | No docs sidebar tab |
| mentions.enabled | false | No @ suggestions |
| backup.enabled | false | No backup UI elements |

---

### Phase 6: Documentation Updates

#### Task 6.1: Update Feature Flag Documentation
- [ ] Document expected behavior for each feature flag
- [ ] Document sub-flags (workflows.editor, etc.)
- [ ] Clarify that changes require reload
- [ ] Add troubleshooting section

**Files to Update**:
- `README.md` or create `docs/feature-flags.md`

**Estimated Lines**: ~100 lines of documentation

---

## Testing Strategy

### Unit Tests (Required)
- Component-level tests for feature flag gating
- Mock `useOr3Config()` to return different configurations
- Verify components/functions behave correctly when features disabled

### Integration Tests (Manual)
- Test each feature flag in isolation
- Test combinations (e.g., workflows on but editor off)
- Test reload behavior vs runtime behavior

### Regression Prevention
- Ensure existing functionality still works when features are enabled
- No breaking changes to current workflows

---

## Risk Assessment

### Low Risk
- Adding feature flag checks to components (defensive, can't break working features)
- Documentation updates
- Test additions

### Medium Risk  
- Splitting pane registration logic (could affect HMR or cleanup)
- Mitigation: Test thoroughly in dev mode with HMR

### No Risk
- Adding info banner to admin page (purely informational)

---

## Rollback Plan

If issues are discovered:
1. Revert commits in reverse order
2. Feature flags remain functional at plugin level (current behavior)
3. Document known issues for future fix

---

## Success Criteria

1. ✅ Workflows completely hidden when disabled (no sidebar, pane, or messages)
2. ✅ Workflow editor can be independently disabled from viewing
3. ✅ Admin UI clearly communicates reload requirement
4. ✅ All tests pass
5. ✅ Manual testing confirms all features can be toggled
6. ✅ No regressions in enabled feature functionality

---

## Implementation Order

**Day 1: Critical Fixes**
1. Task 1.1: Fix ChatMessage.vue (30 min)
2. Task 1.2: Fix ChatContainer.vue (30 min)
3. Task 2.1: Fix workflows.client.ts (20 min)
4. Task 5.2: Manual smoke test (30 min)

**Day 2: Documentation & Polish**
1. Task 3.1: Add info banner (15 min)
2. Task 4.1-4.4: Audit other features (1-2 hours)
3. Task 5.1: Add unit tests (2 hours)

**Day 3: Final Testing**
1. Complete manual testing matrix (1 hour)
2. Task 6.1: Update documentation (1 hour)
3. Final review and commit

**Total Estimated Time**: 6-8 hours

---

## Notes

- **Keep it Simple**: Don't build reactive feature flag system - reload is acceptable
- **Follow Existing Patterns**: Documents plugin shows the right approach
- **Test Thoroughly**: Feature flags are critical for admin functionality
- **Document Clearly**: Users need to understand the reload requirement

---

## Open Questions

1. Should API endpoints also be gated by feature flags? (Security check needed)
2. Do we need a "restart required" indicator in admin UI?
3. Should disabled feature data be hidden from database queries?

**Decision**: Address in future iteration if needed. Current plan focuses on UI-level gating which is the reported issue.
