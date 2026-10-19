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

- [x] **Password wording:** Open **Create Account** and **Change Password**. Confirm the hint says **Use at least 8 characters**. With a disposable account, try an overlong password and one with many emoji; confirm the error asks you to shorten it without mentioning bytes. Correct the password and confirm you can continue.
  notes (Claude, run against local dev instance with the sibling `or3-provider-basic-auth` build):
  - Hint, overlong/emoji error ("Password is too long. Please shorten it.") and recovery all pass on both forms.
  - Change Password: a wrong current password only says "Unable to change password" (every server error is swallowed; no "current password is incorrect", no rate-limit/session-expired message).
  - Change Password: after success the user is signed out and dropped on the welcome page with no message. No warning beforehand, no "Password updated, sign in again" afterward.
  - Wording drift: Create Account says "Passwords must match." and Change Password says "Passwords do not match".
  - The overlong error never says what the limit is, so a 40-character password with accents can be rejected with no explanation.
  - Release note: this wording, the "Invite code (from your invite link)" label and the email-mismatch message exist only in the sibling `or3-provider-basic-auth` source (loaded by `bun run dev:ssr`). The installed `0.0.13` in `or3-chat/node_modules` still has the old "72 UTF-8 bytes" / "paste invite token" text, and production builds use the installed package. These fixes need a new provider version before they reach a deployed instance.
  - Lock page (`/welcome`) can show the raw error `Session check failed [GET] "/api/auth/session": 429 Rate limit exceeded. Retry after 37s`. `/api/auth/session` is limited to 60 requests/min/IP (`rate-limiter.ts`) and a page load costs about 6, so repeated reloads (or many people behind one IP) hit it. The **Retry** button reloads immediately instead of waiting. It should say "Too many attempts. Try again in 40 seconds." without the HTTP details.
- [x] **Invitations:** In **Registration → Invitations**, create an invite for a test recipient, copy the link, and open it in a separate session. Check expiry controls and copy feedback. Confirm registration says **Invite code (from your invite link)** and fills in the code. Without an invite link, confirm **Invite code (optional)** and the placeholder **Paste invite code**.
  notes (Claude):
  - Passes: short code (`XXXX-XXXX`), link fills the code, label/placeholder match. Without a link the label is "Invite code (optional)".
  - Copy feedback: "Copied." appears under the Create invite button, ~200px above the Copy link button, as plain text. It never clears and doesn't say what was copied (code or link).
  - After creating, the panel never says the invite only works for that one email. That is the cause of the mismatch error below. It also doesn't say OR3 does not email invitations; the admin has to send the code/link.
  - Create form keeps the recipient email after success; the new-invite panel doesn't state the expiry date.
  - Admin shows the code as `SM7J-ADMN` but the link and the signup field use `SM7JADMN`. Both are accepted.
  - Expiry is a raw "Expires in hours" number (1-720) with native browser validation bubbles. Presets ("1 day / 3 days / 7 days / 30 days") would be friendlier. The workspace team-invite form calls the same thing "TTL hours".
  - You can create an invite for an email that already has an account with no warning. The recipient then gets "Unable to register. If you already registered, sign in to continue."
  - A signed-in person who opens an invite link silently lands in the app; nothing says the invite was ignored or to sign out first. This hits anyone testing their own link in the same browser.
  - A stale or mistyped code blocks signup even in open mode, where the field is optional. The error never says you can clear it.
  - The "Invites are optional" alert and the history list render late; for a moment the page shows "No invitations." (a false empty state) before history loads.
- [x] **Invitation email mismatch:** Open a test invite link and enter a different email or a typo. Confirm the error says the invitation is for a different email and asks you to check for typos or use the email that received the invite. The form should preserve your entries. Correct the email (capitalization should not matter) and confirm signup succeeds with the same invitation.
  notes (Claude):
  - Passes: "This invitation is for a different email address. Check for typos or use the email that received the invite." Entries preserved. `Invite-Test-1@EXAMPLE.test` succeeded with the same invite and a hyphenated code.
  - Improvement: show a masked hint of the invited address (`i•••@example.test`), so a typo is easy to spot. The error appears below the fold of a short window next to the buttons; the email field isn't highlighted.
- [x] **Invalid invitation code:** With a fresh test invitation, change part of the code and try signing up, including with a different email. Confirm the error identifies an invalid or expired code, rather than an email mismatch. Restore the code and correct the email; confirm signup succeeds. Also try an expired code and a missing code in invite-only mode; check that each message explains what to do next.
  notes (Claude):
  - Passes: a changed code with a wrong email says "This invite code is invalid or has expired. Check your invite link or ask for a new invitation."; restoring it succeeds.
  - Expired (60 s invite via API), already-used, revoked and garbage codes all show that same message. A used code should say "already been used; if that was you, sign in", and expired could say "expired; ask for a new one".
  - Not exercised live: missing code in invite-only mode (needs a mode switch and restart). The server says "Enter an invite code to create an account." But the signup field label is fixed to "Invite code (optional)" because the form doesn't know the mode, so in invite-only mode it contradicts the error. Needs a live check.
  - Observation: an invite is only marked accepted when the new user's first session loads, not when the account is created. An account made by the API without loading the app left its invite "pending" until it expired.
- [x] **Invitation history:** Check statuses, dates, refresh, and revoking an unused test invite. Is the difference between signup invitations and workspace team invitations clear?
  notes (Claude):
  - Statuses (pending/accepted/revoked/expired), Refresh, and revoke all work, and the list updates.
  - Every row says "Expires <date>", even accepted and revoked ones. Show "Accepted <date>" / "Revoked <date>" and a created date; the data already has them. Status is raw lowercase text with no badge or colour, and "Created by admin" adds little.
  - Revoke acts immediately: no confirmation, no toast. The workspace team-invite page confirms ("Revoke invite?") and toasts, so the two invite screens behave differently.
  - Not clear: both screens say "Create invite". The signup page only says "Each recipient gets their own private workspace." Nothing explains that this is for new accounts and that team invites (Workspaces → a workspace → Team invites) add someone to an existing workspace. Add a one-line explanation and link each way.
- [x] **Administrators:** Search for an existing user and a nonexistent user. Grant and revoke access for a test account; inspect confirmations and list updates.
  notes (Claude):
  - **Bug:** a newly granted admin shows "Granted Jan 21, 1970". The SQLite store returns `created_at` in unix seconds (`or3-provider-sqlite/.../sqlite-store.ts`, `listAdmins`) and the UI formats it as milliseconds. Workspace `createdAt` from the same store is also in seconds (`/api/admin/workspaces` returns e.g. `1792371413`), so any workspace date shown in Admin will read 1970 too. Check this in the Workspaces section.
  - **Bug:** after revoking from "Current Admins", the search result above still says "Already Admin" and offers no Grant button until you search again. The list and toast update correctly.
  - Misleading: the page says "No admin users configured" while you are signed in as the admin. The env-configured super admin isn't listed.
  - Expectation gap: "Grant Admin Access" suggests the person can now use the admin panel. Verified: only the Convex provider registers a deployment-admin checker (`registerDeploymentAdminChecker`); on SQLite the checker is deny-all, so a stored grant is never used. Where a checker exists, a granted account that is signed in to OR3 can open only Plugins and File settings (`admin-auth` middleware); the admin login still takes only the env username/password. (Fixed: the page now says which case applies.)
  - Naming: sidebar says "Administrators", page says "Admin Users" with the subtitle "Manage deployment admin access" ("deployment" is jargon). The "Back to Workspaces" button on a top-level sidebar page is odd.
  - Revoke confirmation says "this user" and doesn't name them (grant does). No "(you)" marker or last-admin guard.
  - Search works on a partial email and shows the display name; nonexistent gives `No users found matching "zzz-nobody"` in faint small text with no next step ("they need to create an account first"). There's no loading indicator during the 300ms debounce plus fetch. Escape cancels dialogs correctly.
  - Narrow window (375px): Invitations and Administrators fit without horizontal scroll. In the signup modal the error shows, but Create account/Cancel sit below the fold inside the modal, so you scroll to retry.

### Fixes applied after this section (verified in the browser; retest with the steps above)

- **1970 dates:** `or3-provider-sqlite` now returns `createdAt` in milliseconds for admins and workspaces. "Granted" and workspace "Created" dates are correct.
- **Administrators:** page title matches the sidebar, "Back to Workspaces" is gone, search shows a loading state, "Already Admin"/"Grant Access" follows the live admin list, and the revoke confirmation names the user.
- **Invitations:** inline "Code copied"/"Link copied" on the button (no alert), status badges with "Accepted/Revoked/Expired <date>" and invite dates, expiry presets (1/3/7/30 days), a note that OR3 doesn't email invitations and the invite only works for that address, a pointer to workspace Team invites, a confirmation and toast on revoke, and "Loading invitations…" instead of a false empty state.
- **Change Password:** specific errors (incorrect current password, too many attempts, session expired), "Passwords must match." wording, a heads-up that it signs you out everywhere, and a "Password updated" notice on the sign-in screen after the sign-out.
- **Invalid invite code in open mode:** the error now says to clear the code to sign up without one.
- **Invite cookie:** signing out now clears the leftover invite cookie. Before, registering a different email with a blank code within 10 minutes of an invite signup was rejected with "different email address".
- **Lock page errors:** a rate limit now says "Too many attempts. Please wait N seconds and try again." and other raw request errors fall back to the plain default. The error state shows a full-width **Try again** button alongside provider account controls, so someone denied registration can still sign out or switch accounts.
- **Invite-only (live, then restored to Open):** signup label reads "Invite code (required)"; a blank code shows "Enter an invite code to create an account. Use the link or code from your invitation." before sending; the server says the same for a missing code. Expired codes say "This invitation has expired. Ask for a new invitation."; garbage, revoked and already-used codes say "This invite code isn't valid. It may be mistyped, already used, or cancelled."; a valid invite still signs up. Open mode keeps "(optional)".
- **Session-check bursts (fixed):** a failed `/api/auth/session` check used to be repeated by every startup caller (30 requests per load, measured), exhausting the 60/min limit and turning errors like a 403 into "Too many attempts". Fixes: `useSessionContext` shares one automatic fetch and waits 10 s after any failure; session fetches no longer use `ofetch`'s automatic immediate retry (it resent a 429 into the same limit); the startup plugin and lock page no longer trigger a second automatic load next to their own refresh (`autoLoad: false`); and the basic-auth sidebar button reads the shared session instead of fetching its own, announcing auth events and leaving the refresh to the host (the host decides whether to reload by comparing the session before and after its own refresh). Measured per page load: failing check 30 → 2, signed out 4 → 3 (two of those are the deliberate signed-out re-checks), signed in 2 → 1. The server side adds about 2 more per load, so the 60/min limit is roughly 20 page loads a minute per IP. The lock page also shows a 403's own sentence (e.g. "A valid invite is required to register.") instead of generic text.
- **Administrators:** the page now says whether grants are used (`grantsEnforced` from `GET /api/admin/admin-users`). On SQLite it shows "Grants aren't used on this deployment" and the grant confirmation says it won't give access; where grants are enforced it says the person can open Plugins and File settings. The enforced wording is from the code and docs; I could not test it without a Convex deployment.
- Still open: used, revoked and never-valid codes can't be told apart server-side (the store only looks up pending invites), so they share one message by design. An account created over the API but never opened in the app stays "pending" and, in invite-only mode, can't get a session without the invite cookie.

## Workspaces

- [x] **Discovery:** Search, filter, paginate where available, and open details. Try a search with no results.
- [x] **Creation:** Create a workspace, including owner search and selection. Try missing required fields and Cancel.
- [x] **Members:** Add a test member, change their role, and remove them. Check identity labels and confirmation wording.
- [x] **Access:** Walk through guest access and team invitations. Is it obvious who gains access and to which workspace?

Walkthrough notes — October 18, 2026 (Chrome):

- Fixed the workspace filter displaying `false` and an empty menu. It now offers **Active only** and **Include deleted**. Corrected single-member wording and added page ranges.
- An isolated browser regression also verified search, deleted-workspace recovery discovery, and pagination across 21 matching workspaces. Those fixtures were removed with the disposable test database.
- Widened creation inputs. Owner search works with Enter and explains when no accounts match. Missing required fields prevent creation; Cancel returns without creating anything.
- Added a test member, changed Viewer to Editor, then removed them. Roles now have plain explanations, and the last owner cannot accidentally be removed or demoted. Deleted workspaces disable membership and invitation controls.
- Guest access now explains that it applies to shared items and does not make the whole workspace public. Turned it on and off in an empty workspace. Opening a real guest-shared item still needs a separate sharing fixture.
- Team invitations now name the workspace, label each field, use expiry choices in days, and explain that OR3 does not send an email. Invalid email input is rejected before submission. Tested creating and cancelling links; clipboard failures now offer manual copying instead of claiming success.
- File settings use everyday labels and full-width inputs. Saving and reloading preserved the change. Member updates no longer erase an unsaved settings draft, and editing after a save shows **Unsaved changes**.
- Removed the test member, cancelled both test invitations, restored guest access and file settings, and soft-deleted **UX Walkthrough — disposable**. It remains recoverable through **Include deleted**.

## Experience

- [x] **UI and Branding:** Review every setting's label, help text, input size, and grouping. Save a small change and verify the visible result after any required restart.
- [x] **Features:** Toggle a feature on and off. Check whether dependencies, unavailable options, save state, and restart requirements are understandable.
- [x] **Themes:** Preview a theme, then inspect choosing the site default. Is the distinction between browser preview and site default obvious? Check import/install controls where available.

Walkthrough notes — October 18, 2026 (Chrome):

- Reviewed all Branding and Features labels and help text. Replaced terms such as favicon, pane count, and workflow execution with clearer wording, and explained feature dependencies.
- Branding and Features originally had no dashboard save path. They now have editable controls, persistent saves, validation, and clear reload guidance. No restart is needed for these settings.
- Saved a temporary site name in Chrome and verified the browser title and form after reload. Turned Workflows off, saved, and verified the saved value after reload. Restored both original values. Checked phone-width fields, keyboard switching, and reachable save/discard controls.
- Previewed Retro, reloaded to confirm it persisted in this browser, and restored Blank. The site default stayed Blank. Theme cards now separate the preview and default badges, show full descriptions, and fit a phone-width window.
- Replaced unusable per-theme default/hide controls with clear configuration guidance. Import fields fill the dialog width, reject incomplete links locally, and explain the trust requirement in plain language. Tested validation and Cancel; did not install or remove third-party theme code.

### Retest Workspaces and Experience fixes

- [ ] Search for an existing workspace and a name with no results. Switch between **Active only** and **Include deleted**; confirm a deleted test workspace appears only when included. With more than 20 results, check Next/Previous and the displayed range.
- [ ] Open **Create Workspace**. Check full-width fields, missing name/owner, an owner search with no matches, keyboard search with Enter, selecting the correct email, and Cancel without creating a workspace.
- [ ] In an empty test workspace, add a Viewer, change them to Editor, and remove them. Confirm role help and named confirmations are clear. The last owner's role and Remove controls should be disabled with an explanation.
- [ ] Edit a file setting without saving, then add or update a test member. Confirm the draft remains. Save, reload, and verify persistence; edit again and confirm **Unsaved changes** replaces the saved message. Restore the original value.
- [ ] Check guest access wording, toggle it on and off in an empty workspace, and restore its original value. Separately verify a guest can open an intentionally shared item without gaining access to private workspace content.
- [ ] In **Team invitations**, try an invalid email, then create an invitation for a test recipient. Check role, expiry in days, workspace name, and the explanation that you must send the link yourself. Copy the link and check success feedback; if copying is blocked, check the manual-copy fallback. Cancel the invitation and confirm the link stops working.
- [ ] Soft-delete an empty test workspace. Confirm the deletion notice explains recovery and membership, guest access, and invitation controls are disabled. Find it with **Include deleted** and restore it if needed.
- [ ] Review **UI & Branding** and **Features**. Confirm controls are editable for the site owner, help text uses plain language, and **No restart needed** explains refreshing open pages.
- [ ] Preview Retro, reload, confirm **Previewing here** stays on Retro while **Site default** stays on Blank, then restore your original preview.
- [ ] Open **Import from link**, enter an incomplete link, and confirm a clear inline error appears without starting an installation. Cancel and reopen; the previous input/error should be cleared.
- [ ] Repeat creation, invitations, theme cards, and import validation at phone width. Check wrapping, reachable buttons, keyboard controls, and no horizontal page scrolling.

Verification: workspace discovery/creation/deletion/pagination, theme/settings UX, both desktop and mobile team-invite signup, and file-settings persistence/retention regressions passed. App typecheck and documentation checks passed. Repeatable browser artifacts are in `test-results/admin-workspace-final/`, `test-results/admin-workspace-experience/`, `test-results/file-backup-cloud/`, and `test-results/admin-ux-chrome/`.

### Retest dashboard settings saves

- [ ] In **UI & Branding**, change the site name, description, logo, browser tab icon, and policy links using test values. Save, use **Reload this page**, and check the visible result and saved values. Refresh a second tab to check it also receives the changes. Restore the original values afterward.
- [ ] Choose a different **Site default theme**, save, and open a fresh browser profile without a theme preference. Check the new default is active. Your existing personal preview should stay unchanged. Restore the original default. Check the current default cannot also be hidden.
- [ ] Change **Starting chat panels** and the sidebar starting preference. Open a fresh browser/workspace using Standard OR3 and check the defaults. Existing layouts and a person's sidebar choice should stay intact. Check **Maximum chat panels** limits new splits; custom layouts and small screens may allow fewer.
- [ ] Try a blank site name, a link without a valid address, and a starting panel count greater than the maximum. Save must show a helpful error, preserve your draft, and leave all saved settings unchanged. Use **Discard changes** to restore the loaded values.
- [ ] Open the editor in two tabs. Save in one, then try saving an older draft in the other. Confirm a conflict explains what happened, keeps the draft, and offers **Reload saved settings**. Reload deliberately, review the latest values, and retry.
- [ ] In **Features**, turn **Documents** off, save, and refresh the app. Document creation should disappear. Turn it back on and verify it returns with existing documents intact. Repeat with a test feature such as Backups or Dashboard and restore the original values.
- [ ] Turn **Workflows** or **Chat references** off. Dependent choices should explain why they are inactive without erasing their saved choices. Document references also require Documents. Workflows still needs its plugin installed and enabled for the workspace.
- [ ] Reload both editors, then restart the development server and check the saved values remain. A restart is a persistence check, not a requirement to apply these settings. Registration continues to use its separate restart guidance.
- [ ] Repeat at phone width and with the keyboard. Check readable labels, theme menus, switches, visible save/loading/error feedback, and reachable **Save changes** and **Discard changes** controls. A non-owner must not be able to save.

Verification: the isolated settings browser journey and a second server-start persistence check passed. They cover save/reload, actual document creation availability, layout defaults, invalid input without partial saves, conflicting drafts, and request permissions. All 20 focused configuration tests, app and server typechecks, and documentation checks passed. Repeatable artifacts are in `test-results/admin-settings/`, `test-results/admin-settings-restart/`, and `test-results/admin-ux-chrome/`. The retest items above remain unchecked for your own pass.

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
