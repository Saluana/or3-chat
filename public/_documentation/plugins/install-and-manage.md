# Install and manage plugins

Open **Dashboard → Marketplace** to find plugins approved for your site, see
what is installed, and manage updates. A plugin's selected code version is
shared by the instance; whether it is enabled is decided per workspace.

## Before installing

You need an authenticated OR3 Cloud workspace and a site configured for
marketplace installation. Static builds cannot install or run these packages.
Portable plugins currently require a Chromium browser. If installation is
unavailable, the page explains the missing configuration or permission;
[Runtime and security](/documentation/plugins/runtime-and-security#operator-configuration) covers
administrator setup.

Installing requires an owner or administrator with the required authority.
Browsing a workspace catalog does not grant installation authority. The global
system-admin login is separate from a regular Chat session.

## Find and install a plugin

1. Open **Discover**, search or filter, and view a plugin's details.
2. Review the exact version, requested permissions, external costs, and
   compatibility. If it is a paid release, connect the account that owns it in
   [Your Library](/documentation/plugins/library).
3. Choose the installation action and approve the requested access.
4. Complete **Configure** if settings or a connection are required. Continue
   the same installation when setup is ready.
5. Let the browser finish the package check. Once installed, choose **Open**
   and exercise the plugin's first useful action.

The server downloads and verifies the signed package; a plugin cannot choose
an arbitrary download URL. The installation records its progress, so refreshing
or closing the page does not erase completed work.

An empty Discover list can mean the administrator has not approved any releases
for the site. In **Admin → Plugins → Site catalog**, a system administrator
reviews a signed exact release and chooses **Approve for this site**. Hiding a
listing blocks new acquisition and enablement; it does not stop workspaces
already running it. A purchase in Library does not bypass site approval.

## Installed, enabled, and running

| State | Meaning | What to do |
| --- | --- | --- |
| Installed | A verified package version is selected on the instance | Enable it in the workspace where you want to use it |
| Enabled | The workspace allows that package | Finish its permission review and setup if needed |
| Running | This browser observed the exact selected package activate | Open it and check the feature you intend to use |
| Needs setup | Required settings or connections are incomplete | Open Configure, finish setup, and Continue |
| Browser check pending | Installation exists but activation was not observed here | Open the plugin or use Run check; do not reinstall just to repeat the check |

**Installed → Run check** refreshes the server state and observes activation in
the selected workspace for up to 30 seconds. It does not run a paid model call
or a workflow. A successful activation is not proof that every plugin feature works.
Portable packages can supply sidebar navigation, workspace tabs, dashboard views,
and permission-gated chat tools. Each plugin decides which features it implements.

## Enable another workspace

Use **Installed** to enable an already installed plugin in another workspace.
Review that workspace's permissions and setup. This does not install a second
copy of the package.

A system administrator can use **Enable workspaces** in Marketplace, or
**Enable or disable workspaces** in Admin, to preview a selected set, all existing
workspaces, or a default for new workspaces. Inspect the exact version and
blocked workspaces before applying. Continue or retry unresolved results in the
saved rollout. Canceling remaining work preserves completed changes. The default
for new workspaces is saved separately from an existing-workspace rollout.

A workspace requiring setup stays disabled. If workspace creation reports a
plugin warning, open its recorded rollout; creating a second workspace is not
a repair step. When a write is still applying, refresh progress before retrying.

## Update a plugin

Open **Updates** or choose **View updates** from an installed plugin. Checking
for updates requires system-administrator access. A newer public release must
first be approved for this site.

Review the current and proposed versions, permission changes, and affected
workspaces. The update changes the shared code selection for every enabled
workspace. Existing approvals can carry forward when access is unchanged;
expanded access needs administrator approval. A workspace with incomplete setup
or incompatible state blocks promotion and leaves the selected version running.
Switch to the named workspace, resolve the blocker, and Continue the operation.

A failed check before promotion preserves the running selection. If a problem
occurs after promotion, inspect the actual selected and observed versions; do
not assume an automatic rollback happened.

## Restore, disable, and uninstall

| Action | Scope | Saved data |
| --- | --- | --- |
| Restore previous version | Changes the shared selected code after permission, setup, dependency, and state checks | Preserved; code restoration does not undo data migrations |
| Disable | Stops the plugin in a workspace | Preserved for re-enabling |
| Uninstall | Removes the selected package from every workspace | Retained unless explicitly deleted through a separate operation |

**View details → Restore previous version** opens an impact review. Every
currently enabled workspace must be compatible with the retained version.
If the selection or workspace set changes, refresh the review. A refused restore
keeps the current version selected. Run a browser check after restoration.

For a workspace-only change, use Disable. Uninstall asks you to confirm the
instance-wide scope and exact package. It first disables the plugin across live
workspaces; a failed workspace write can leave a partial result for you to retry.

## Recover an interrupted installation

| Message or problem | Next step |
| --- | --- |
| Continue / interrupted | Resume the same recorded operation |
| Needs setup | Open Configure for the recorded workspace and version, then Continue |
| Unsupported browser | Open the link in a qualified Chromium browser |
| Connect Library / coverage required | Link the account that owns the release, then retry |
| Permissions changed or review stale | Refresh and review the exact release again |
| Registry unavailable or download interrupted | Retry when connectivity returns; the operation retains its identity |
| Release quarantined or signature refused | Ask the administrator to select a verified permitted release |
| Installed; activation not confirmed | Open, Run check, or retry plugin startup |

Cancel is available before promotion commits. A cancellation preserves completed
work and the current package. Failed history does not retry itself on refresh.
Operations belong to their recorded workspace; switch there before resuming.
Reopen Configure from Marketplace if an old setup link names a different
workspace, version, or operation.

Use **Technical details → Copy diagnostic report** when asking for help. It
includes package and operation identifiers and structured failure codes, while
excluding credentials, settings values, and document/chat content. Review the
identifiers before sharing.

## If you cannot install

A member can view a plugin and share its administrator deep link. A member
with an acquired Library version can also use **Request installation**. The
administrator reviews that exact version and workspace; the buyer's credential
stays on the server. See [Your Library](/documentation/plugins/library).
