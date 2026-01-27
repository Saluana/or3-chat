# Manual Testing Checklist - Admin Settings Integration

**Purpose:** Verify that all feature flags properly control their respective UI elements after the admin settings integration fixes.

**How to Test:** 
1. Modify `config.or3.ts` to enable/disable features
2. Reload the browser after each config change
3. Verify expected behavior

---

## Testing Environment Setup

### Prerequisites
- [ ] OR3 Chat application running locally
- [ ] Access to `config.or3.ts` file for editing
- [ ] Browser DevTools open for console logs

### Before You Start
- [ ] Take note of current `config.or3.ts` settings
- [ ] Create a backup of current config for easy restoration

---

## Test Suite 1: Workflows Feature

### Test 1.1: Workflows Completely Disabled

**Config Change:**
```ts
features: {
    workflows: {
        enabled: false,  // ← Set to false
        editor: true,
        slashCommands: true,
        execution: true,
    },
}
```

**Steps:**
1. [ ] Save config file
2. [ ] Reload browser (hard refresh: Ctrl+Shift+R or Cmd+Shift+R)
3. [ ] Check sidebar - workflow tab should NOT appear
4. [ ] Try to open workflow pane - should NOT be available
5. [ ] Check existing workflow messages - should NOT render as workflows
6. [ ] Check browser console for: `[workflows] Plugin disabled via OR3 config`

**Expected Results:**
- ✅ No workflow sidebar tab
- ✅ No workflow pane in available apps
- ✅ Workflow messages render as regular messages (not special workflow UI)
- ✅ Console shows workflows disabled message

**Actual Results:**
- [ ] Pass / [ ] Fail
- Notes: _______________________________________________

---

### Test 1.2: Workflows Enabled, Editor Disabled

**Config Change:**
```ts
features: {
    workflows: {
        enabled: true,
        editor: false,  // ← Set to false
        slashCommands: true,
        execution: true,
    },
}
```

**Steps:**
1. [ ] Save config file
2. [ ] Reload browser
3. [ ] Check sidebar - workflow tab SHOULD appear
4. [ ] Try to open workflow pane - should NOT be available
5. [ ] Workflow messages should display in read-only mode
6. [ ] Check console for workflow initialization logs

**Expected Results:**
- ✅ Workflow sidebar tab is visible
- ✅ NO workflow pane/editor available
- ✅ Workflow messages render (read-only)
- ✅ Can view workflows but not edit them

**Actual Results:**
- [ ] Pass / [ ] Fail
- Notes: _______________________________________________

---

### Test 1.3: Workflows Enabled, Slash Commands Disabled

**Config Change:**
```ts
features: {
    workflows: {
        enabled: true,
        editor: true,
        slashCommands: false,  // ← Set to false
        execution: true,
    },
}
```

**Steps:**
1. [ ] Save config file
2. [ ] Reload browser
3. [ ] Open chat input
4. [ ] Type `/workflow` - should NOT show autocomplete
5. [ ] Workflow editor should still be available
6. [ ] Workflow messages should render normally

**Expected Results:**
- ✅ No `/workflow` slash commands in autocomplete
- ✅ Workflow editor still works
- ✅ Workflow sidebar still visible
- ✅ Existing workflows still execute

**Actual Results:**
- [ ] Pass / [ ] Fail
- Notes: _______________________________________________

---

### Test 1.4: Workflows Enabled, Execution Disabled

**Config Change:**
```ts
features: {
    workflows: {
        enabled: true,
        editor: true,
        slashCommands: true,
        execution: false,  // ← Set to false
    },
}
```

**Steps:**
1. [ ] Save config file
2. [ ] Reload browser
3. [ ] Try to execute a workflow
4. [ ] Workflow should not actually run
5. [ ] Workflow editor should be available
6. [ ] Workflow messages should display but not execute

**Expected Results:**
- ✅ Workflow editor available
- ✅ Workflow sidebar visible
- ✅ Workflow messages display but don't execute
- ✅ Execution button disabled or shows error

**Actual Results:**
- [ ] Pass / [ ] Fail
- Notes: _______________________________________________

---

### Test 1.5: Workflows Fully Enabled (Control Test)

**Config Change:**
```ts
features: {
    workflows: {
        enabled: true,
        editor: true,
        slashCommands: true,
        execution: true,
    },
}
```

**Steps:**
1. [ ] Save config file
2. [ ] Reload browser
3. [ ] Verify all workflow features work
4. [ ] Try creating a new workflow
5. [ ] Try executing a workflow
6. [ ] Try using `/workflow` commands

**Expected Results:**
- ✅ Full workflow functionality available
- ✅ Can create, edit, and execute workflows
- ✅ Slash commands work
- ✅ Sidebar and pane available

**Actual Results:**
- [ ] Pass / [ ] Fail
- Notes: _______________________________________________

---

## Test Suite 2: Documents Feature

### Test 2.1: Documents Disabled

**Config Change:**
```ts
features: {
    documents: {
        enabled: false,  // ← Set to false
    },
}
```

**Steps:**
1. [ ] Save config file
2. [ ] Reload browser
3. [ ] Check sidebar - "Docs" tab should NOT appear
4. [ ] Try to access documents - should not be available
5. [ ] Check console for any document-related errors

**Expected Results:**
- ✅ No "Docs" tab in sidebar
- ✅ Cannot access document editor
- ✅ No document-related UI elements

**Actual Results:**
- [ ] Pass / [ ] Fail
- Notes: _______________________________________________

---

### Test 2.2: Documents Enabled (Control Test)

**Config Change:**
```ts
features: {
    documents: {
        enabled: true,
    },
}
```

**Steps:**
1. [ ] Save config file
2. [ ] Reload browser
3. [ ] Check sidebar - "Docs" tab SHOULD appear
4. [ ] Can create and edit documents
5. [ ] Document editor fully functional

**Expected Results:**
- ✅ "Docs" tab visible in sidebar
- ✅ Can create/edit documents
- ✅ Full document functionality

**Actual Results:**
- [ ] Pass / [ ] Fail
- Notes: _______________________________________________

---

## Test Suite 3: Mentions Feature

### Test 3.1: Mentions Completely Disabled

**Config Change:**
```ts
features: {
    mentions: {
        enabled: false,  // ← Set to false
        documents: true,
        conversations: true,
    },
}
```

**Steps:**
1. [ ] Save config file
2. [ ] Reload browser
3. [ ] Type `@` in chat input
4. [ ] Should see NO mention suggestions
5. [ ] Check console for: `[mentions] Plugin disabled via OR3 config`

**Expected Results:**
- ✅ No mention suggestions appear
- ✅ `@` is treated as regular character
- ✅ Console shows mentions disabled message

**Actual Results:**
- [ ] Pass / [ ] Fail
- Notes: _______________________________________________

---

### Test 3.2: Mentions Enabled, Documents Disabled

**Config Change:**
```ts
features: {
    mentions: {
        enabled: true,
        documents: false,  // ← Set to false
        conversations: true,
    },
}
```

**Steps:**
1. [ ] Save config file
2. [ ] Reload browser
3. [ ] Type `@` in chat input
4. [ ] Should see conversation mentions but NOT document mentions
5. [ ] Verify only conversation suggestions appear

**Expected Results:**
- ✅ Conversation mentions work
- ✅ NO document mentions in suggestions
- ✅ Console shows mentions enabled but documents disabled

**Actual Results:**
- [ ] Pass / [ ] Fail
- Notes: _______________________________________________

---

### Test 3.3: Mentions Fully Enabled (Control Test)

**Config Change:**
```ts
features: {
    mentions: {
        enabled: true,
        documents: true,
        conversations: true,
    },
}
```

**Steps:**
1. [ ] Save config file
2. [ ] Reload browser
3. [ ] Type `@` in chat input
4. [ ] Should see both document and conversation suggestions
5. [ ] Can use mentions in messages

**Expected Results:**
- ✅ All mention types available
- ✅ Both documents and conversations suggest
- ✅ Full mention functionality

**Actual Results:**
- [ ] Pass / [ ] Fail
- Notes: _______________________________________________

---

## Test Suite 4: Backup Feature

### Test 4.1: Backup Disabled

**Config Change:**
```ts
features: {
    backup: {
        enabled: false,  // ← Set to false
    },
}
```

**Steps:**
1. [ ] Save config file
2. [ ] Reload browser
3. [ ] Open dashboard (if dashboard is enabled)
4. [ ] Open Workspaces plugin
5. [ ] "Backup & Restore" page should NOT appear
6. [ ] Only "Manage Workspaces" page should be visible

**Expected Results:**
- ✅ No "Backup & Restore" page in Workspaces
- ✅ "Manage Workspaces" still available
- ✅ Cannot access backup functionality

**Actual Results:**
- [ ] Pass / [ ] Fail
- Notes: _______________________________________________

---

### Test 4.2: Backup Enabled (Control Test)

**Config Change:**
```ts
features: {
    backup: {
        enabled: true,
    },
}
```

**Steps:**
1. [ ] Save config file
2. [ ] Reload browser
3. [ ] Open dashboard
4. [ ] Open Workspaces plugin
5. [ ] "Backup & Restore" page SHOULD appear
6. [ ] Can export and import backups

**Expected Results:**
- ✅ "Backup & Restore" page available
- ✅ Can perform backup operations
- ✅ Full backup functionality

**Actual Results:**
- [ ] Pass / [ ] Fail
- Notes: _______________________________________________

---

## Test Suite 5: Dashboard Feature

### Test 5.1: Dashboard Disabled

**Config Change:**
```ts
features: {
    dashboard: {
        enabled: false,  // ← Set to false
    },
}
```

**Steps:**
1. [ ] Save config file
2. [ ] Reload browser
3. [ ] Check bottom nav (sidebar) - dashboard button should NOT appear
4. [ ] Try to access dashboard - should not be possible
5. [ ] Check that other sidebar features still work

**Expected Results:**
- ✅ No dashboard button in sidebar
- ✅ Cannot open dashboard modal
- ✅ Other features still accessible

**Actual Results:**
- [ ] Pass / [ ] Fail
- Notes: _______________________________________________

---

### Test 5.2: Dashboard Enabled (Control Test)

**Config Change:**
```ts
features: {
    dashboard: {
        enabled: true,
    },
}
```

**Steps:**
1. [ ] Save config file
2. [ ] Reload browser
3. [ ] Dashboard button SHOULD appear in sidebar
4. [ ] Can open dashboard
5. [ ] All dashboard plugins accessible

**Expected Results:**
- ✅ Dashboard button visible
- ✅ Can open dashboard modal
- ✅ All plugins available
- ✅ Full dashboard functionality

**Actual Results:**
- [ ] Pass / [ ] Fail
- Notes: _______________________________________________

---

## Test Suite 6: Admin Settings UI

### Test 6.1: Info Banner Appears

**Steps:**
1. [ ] Access admin dashboard at `/admin`
2. [ ] Navigate to "System" page
3. [ ] Scroll to "Configuration" section
4. [ ] Verify info banner appears above config groups

**Expected Result:**
- ✅ Blue info banner with icon
- ✅ Message: "Changes to feature flags (workflows, documents, etc.) require a page reload..."
- ✅ Banner is clearly visible and readable

**Actual Results:**
- [ ] Pass / [ ] Fail
- Notes: _______________________________________________

---

### Test 6.2: Config Can Be Saved

**Steps:**
1. [ ] In admin System page, modify a setting
2. [ ] Click "Save Configuration"
3. [ ] Verify success (no errors)
4. [ ] Reload page
5. [ ] Verify setting persisted

**Expected Results:**
- ✅ Settings save without errors
- ✅ Settings persist across reloads
- ✅ Admin page functions normally

**Actual Results:**
- [ ] Pass / [ ] Fail
- Notes: _______________________________________________

---

## Summary

### Test Results Overview

**Workflows:**
- Test 1.1 (Disabled): [ ] Pass / [ ] Fail
- Test 1.2 (Editor disabled): [ ] Pass / [ ] Fail
- Test 1.3 (Slash commands disabled): [ ] Pass / [ ] Fail
- Test 1.4 (Execution disabled): [ ] Pass / [ ] Fail
- Test 1.5 (Fully enabled): [ ] Pass / [ ] Fail

**Documents:**
- Test 2.1 (Disabled): [ ] Pass / [ ] Fail
- Test 2.2 (Enabled): [ ] Pass / [ ] Fail

**Mentions:**
- Test 3.1 (Disabled): [ ] Pass / [ ] Fail
- Test 3.2 (Docs disabled): [ ] Pass / [ ] Fail
- Test 3.3 (Enabled): [ ] Pass / [ ] Fail

**Backup:**
- Test 4.1 (Disabled): [ ] Pass / [ ] Fail
- Test 4.2 (Enabled): [ ] Pass / [ ] Fail

**Dashboard:**
- Test 5.1 (Disabled): [ ] Pass / [ ] Fail
- Test 5.2 (Enabled): [ ] Pass / [ ] Fail

**Admin UI:**
- Test 6.1 (Info banner): [ ] Pass / [ ] Fail
- Test 6.2 (Config save): [ ] Pass / [ ] Fail

---

### Total Tests
- **Total Tests:** 16
- **Tests Passed:** _____
- **Tests Failed:** _____
- **Pass Rate:** _____%

---

### Issues Found

**Issue 1:**
- **Test:** _____________________
- **Description:** _____________________
- **Severity:** [ ] Blocker / [ ] High / [ ] Medium / [ ] Low
- **Notes:** _____________________

**Issue 2:**
- **Test:** _____________________
- **Description:** _____________________
- **Severity:** [ ] Blocker / [ ] High / [ ] Medium / [ ] Low
- **Notes:** _____________________

*(Add more as needed)*

---

### Restoration

After testing, restore original config:
- [ ] Restore original `config.or3.ts` from backup
- [ ] Reload browser
- [ ] Verify normal functionality

---

### Sign-Off

**Tester Name:** _____________________  
**Date Tested:** _____________________  
**Overall Result:** [ ] All tests passed / [ ] Some issues found  
**Ready for Merge:** [ ] Yes / [ ] No (see issues)

**Notes:**
_____________________________________________________
_____________________________________________________
_____________________________________________________
