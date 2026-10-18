# OR3 Chat Admin UX Walkthrough

Work through the panel in sidebar order. Mark completed items with `[x]`. Stop and report anything that feels confusing, cumbersome, inconsistent, or broken.

Use disposable accounts and workspaces for changes to access, invitations, and deletion.

For every editable page, try **edit → save → reload**, plus **invalid input → correction**. Check whether it is clear when changes take effect.

## Login and navigation

- [x] **Login:** Try incorrect credentials, then sign in successfully. Check error clarity, password visibility, keyboard submission, and loading feedback.
notes: 
- error message already clear
- auth worked good
- redirected me as expected
- [x] **Navigation:** Visit every sidebar entry. Check grouping, page names, active highlighting, collapse/expand, and browser Back/Forward.
 Notes:
 - navigation seems very fast
 - none of the pages failed to load
 - Is signup invites visible even when registration is open and no invites are required?
- [x] **Overview:** Can you quickly understand the instance's status? Are warnings understandable and clear about what to do next?
   notes: - First page has a warning. Very complicated to understand. must be a technical person to even make sense of it at all. we should provide better guidence on how to resolve the issue. 

## Retest the first walkthrough fixes

- [x] With registration set to `open`, open **Registration → Invitations**. Confirm **Invites are optional** explains that new users can sign up without an invitation. Check that invitation history and Create invite remain available.
      notes:
      - tried to create an invite and got a warning "Invitations need one-time setup" it had clear instructions on how to resolve the issue.
      - added the required enviroment variable and it worked upon further testing, but i noticed the token is suuuuper fucking long. Most invite codes on other websites are like 6 - 8 characters at most. Ours is like a full JWT lol. Very silly looking.
- [x] With registration set to `invite_only` or `disabled`, reload **Registration → Invitations**. Confirm the page does not claim invitations are optional. After a failed history refresh, it should not display an unconfirmed registration policy.
- [x] With filesystem storage enabled, open **Overview** and **Operations**. Confirm **Deleted files still use storage** explains the consequence and the next step without requiring technical knowledge. Expand **Technical details** to inspect the original diagnostic. Other warnings should remain visible.
- [x] Select **View storage usage** in the Overview notice. Confirm Operations opens the workspace chooser immediately, without finding or clicking a second button. Cancel; no observation should run. Repeat from the notice on Operations, including clicking again after canceling.
- [x] Run **View storage usage**, choose a test workspace, and confirm its result is brought into view and receives keyboard focus. Repeat for a second workspace and confirm the result names the workspace you selected. Also try the button on the **Observe Storage Usage** card. Check loading/error feedback and confirm the observation leaves files and Trash unchanged.
- [x] Check the storage summary shows readable sizes for known **Active files**, **In Trash**, and **Files on disk** totals. **Server space available** describes the server, not a workspace allowance. Unknown totals should be omitted with a clear message; a measured empty workspace should show **0 B**. A partial scan should explain that the disk total may be higher.
- [x] Confirm **Show JSON** starts collapsed. Expand and collapse it with a mouse and keyboard; the full response and diagnostic warnings should remain available. Run another check and confirm JSON starts collapsed again. Repeat in a narrow window; the summary and expanded JSON should fit without horizontal page scrolling.
- [x] Repeat the notice and workspace chooser checks in a narrow window. Confirm text, buttons, and dialog controls stay reachable.

## Retest Registration settings

- [x] Open **Registration** from the sidebar. Confirm **Settings** is the default tab, and **Invitations** opens invitation creation and history. Check direct links, reload, browser Back/Forward, and the old `/admin/signup-invites` link.
- [x] In **Settings**, choose a different mode and save. Confirm the current mode stays unchanged and **Restart required** names the saved mode. Reload and switch tabs; confirm the saved selection and notice remain. Save the current mode again to cancel a pending change.
- [x] In the restart notice, select **Restart now**. Confirm it warns about temporary downtime; cancel and confirm no restart occurs. On a disposable instance that supports dashboard restarts, confirm the restart and check loading feedback prevents repeated requests. Reload once OR3 is back; confirm the saved mode becomes current and the notice disappears. If it persists, check whether the deployment environment overrides the saved setting.
- [ ] With dashboard restarts disabled, confirm **Restart now** is disabled and the notice explains how to continue. With the standard source launcher and restarts enabled, confirm saved settings can be applied through a verified development restart. A failed restart should show an error and leave the saved change and restart notice intact.
- [x] Try all three modes after restarting: **Open registration** permits signup without an invitation; **Invite only** requires a valid invitation; **Registration closed** rejects new accounts even with an invitation. Existing test accounts should still sign in in every mode.
- [x] On a disposable instance without invitation setup, confirm Settings explains what to do and prevents saving **Invite only**. Complete setup and restart; confirm Invite only can now be saved. Try a failed load and save; check retry controls, preserved edits, and clear errors.
- [x] Repeat Settings and Invitations in a narrow window and with the keyboard. Confirm tab focus, mode choices, Save, setup guidance, and restart controls remain readable and reachable. Confirm invitation history still reflects the active mode while a change is awaiting restart.

## Registration and administrators

- [ ] **Password wording:** Open **Create Account** and **Change Password**. Confirm the hint says **Use at least 8 characters**. With a disposable account, try an overlong password and one with many emoji; confirm the error asks you to shorten it without mentioning bytes. Correct the password and confirm you can continue.
- [ ] **Invitations:** In **Registration → Invitations**, create an invite for a test recipient, copy the link, and open it in a separate session. Check expiry controls and copy feedback. Confirm registration says **Invite code (from your invite link)** and fills in the code. Without an invite link, confirm **Invite code (optional)** and the placeholder **Paste invite code**.
- [ ] **Invitation email mismatch:** Open a test invite link and enter a different email or a typo. Confirm the error says the invitation is for a different email and asks you to check for typos or use the email that received the invite. The form should preserve your entries. Correct the email (capitalization should not matter) and confirm signup succeeds with the same invitation.
- [ ] **Invalid invitation code:** With a fresh test invitation, change part of the code and try signing up, including with a different email. Confirm the error identifies an invalid or expired code, rather than an email mismatch. Restore the code and correct the email; confirm signup succeeds. Also try an expired code and a missing code in invite-only mode; check that each message explains what to do next.
- [ ] **Invitation history:** Check statuses, dates, refresh, and revoking an unused test invite. Is the difference between signup invitations and workspace team invitations clear?
- [ ] **Administrators:** Search for an existing user and a nonexistent user. Grant and revoke access for a test account; inspect confirmations and list updates.

## Workspaces

- [ ] **Discovery:** Search, filter, paginate where available, and open details. Try a search with no results.
- [ ] **Creation:** Create a workspace, including owner search and selection. Try missing required fields and Cancel.
- [ ] **Members:** Add a test member, change their role, and remove them. Check identity labels and confirmation wording.
- [ ] **Access:** Walk through guest access and team invitations. Is it obvious who gains access and to which workspace?

## Experience

- [ ] **UI and Branding:** Review every setting's label, help text, input size, and grouping. Save a small change and verify the visible result after any required restart.
- [ ] **Features:** Toggle a feature on and off. Check whether dependencies, unavailable options, save state, and restart requirements are understandable.
- [ ] **Themes:** Preview a theme, then inspect choosing the site default. Is the distinction between browser preview and site default obvious? Check import/install controls where available.

## Plugins and webhooks

- [ ] **Plugin scope:** Switch between **Instance** and **Workspace**, then between two workspaces. Always check whether the current target is unmistakable.
- [ ] **Plugin catalog:** Search the catalog, inspect a release, and walk through approval controls. Check installed version, approved version, and defaults for new workspaces.
- [ ] **Plugin setup:** Follow installation, workspace activation, permissions, and configuration for a test plugin. Inspect disabled controls and incomplete setup messages.
- [ ] **Plugin recovery:** Review updates, runtime diagnostics, and advanced source/development controls. Can you tell what needs attention and how to recover?
- [ ] **Webhooks:** Create and edit a test webhook, toggle it, send a test ping to a test endpoint, inspect delivery logs, and delete it. Check success and failure feedback.
- [ ] **Extension pages:** If plugins add admin pages or widgets, check their navigation, layout, loading, and errors.

## Operations and advanced settings

- [ ] **Operations:** Review health, versions, maintenance, and update information. Open action confirmations and cancel them; exercise restart/update actions only on a suitable development instance.
- [ ] **Advanced Settings:** Search by setting name and environment variable, expand groups, and inspect descriptions, secret masking, validation, and save/restart feedback.

## Final pass across the panel

- [ ] **Small screens:** Try a narrow window or phone. Check the navigation drawer, dialogs, tables, long names, and access to Save buttons.
- [ ] **Keyboard and appearance:** Use Tab, Shift+Tab, Enter, and Escape. Check focus visibility, dialog focus, contrast, and both light/dark appearances.
- [ ] **State and feedback:** Look for silent saves, duplicate submissions, disappearing input, endless loading, unclear empty states, and errors without recovery.
- [ ] **Session boundaries:** Reload a nested page, log out, and revisit it. If available, repeat as a workspace administrator and check the controls shown.

## Follow up on Empty Trash

- [ ] Design and implement workspace-scoped **Empty Trash** in Files with a clear irreversible-action confirmation. Coordinate permanent server cleanup with sync and shared file references so files still used by chats, documents, or revisions remain available. Current Remove entry controls retain original server files.

## Reporting an issue

Send **page + what you did + what felt wrong or what you expected**. A screenshot helps with visual issues, but a rough description is enough. After each fix, use the provided retest steps before continuing.
