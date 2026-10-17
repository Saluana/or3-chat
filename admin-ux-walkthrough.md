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

- [ ] With registration set to `open`, open **Signup invites**. Confirm **Invites are optional** explains that new users can sign up without an invitation. Check that invitation history and Create invite remain available.
- [ ] With registration set to `invite_only` or `disabled`, reload **Signup invites**. Confirm the page does not claim invitations are optional. After a failed history refresh, it should not display an unconfirmed registration policy.
- [ ] With filesystem storage enabled, open **Overview** and **Operations**. Confirm **Deleted files still use storage** explains the consequence and the next step without requiring technical knowledge. Expand **Technical details** to inspect the original diagnostic. Other warnings should remain visible.
- [ ] Select **View storage usage** in the notice. Confirm it opens the usage action in Operations. Select **View storage usage** on that card, then cancel the workspace chooser. No observation should run.
- [ ] Run **View storage usage**, choose a test workspace, and confirm the result names that workspace. Repeat for a second workspace. Check loading/error feedback and confirm the observation leaves files and Trash unchanged.
- [ ] Repeat the notice and workspace chooser checks in a narrow window. Confirm text, buttons, and dialog controls stay reachable.

## Signup invites and administrators

- [ ] **Signup invites:** Create an invite for a test recipient, copy the link, and open it in a separate session. Check expiry controls and copy feedback.
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
