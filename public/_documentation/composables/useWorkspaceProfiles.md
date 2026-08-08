# useWorkspaceProfiles

Runtime for workspace profiles. A profile defines which sidebar pages, dashboard tiles, pane apps, and commands a workspace uses, and how many panes are allowed.

## Purpose

`useWorkspaceProfiles()` returns:

-   `profiles` — registered profiles (`ComputedRef<RegisteredWorkspaceProfile[]>`).
-   `selectedProfileId` — the active profile id for the current workspace.
-   `selectedProfile` — the profile registration, falling back to the standard OR3 profile.
-   `resolvedProfile` — the fully resolved profile (inventory applied, pane limits and mobile policy).
-   `initialized` / `pending` / `error` — runtime lifecycle state.
-   `initialPaneRequest` — pending "open initial panes" request after first load.
-   `inventory` — computed union of registered navigation, dashboard, panes, and commands.
-   `applyProfile(profileId)` — switch the workspace to a profile (persists via KV and cookie).
-   `resetToStandard(options?)` — restore the standard profile, optionally resetting the layout.
-   `acknowledgeInitialPanes(token)` — mark the initial panes request as applied.
-   `reloadWorkspaceProfile()` — reload the selection and re-resolve.

Module helpers: `shouldPreserveHydratedWorkspaceProfile`, `initializeWorkspaceProfilesRuntime`, `registerBuiltinWorkspaceProfiles`, `seedWorkspaceProfileRuntime(profileId)`, and `__resetWorkspaceProfileRuntimeForTests`.

## Usage

```ts
import { useWorkspaceProfiles } from '~/composables/workspace-profiles/useWorkspaceProfiles';

const profiles = useWorkspaceProfiles();

watchEffect(() => {
    if (profiles.resolvedProfile.value) {
        console.log('Max panes:', profiles.resolvedProfile.value.maxDesktopPanes);
    }
});
```

## Notes

-   The selection persists per workspace in KV under `WORKSPACE_PROFILE_SELECTION_KEY` and in a cookie for the server.
-   Resolved profiles apply a single-pane policy on mobile.
-   Plugin packages register profiles via `registerWorkspaceProfile`; the built-in standard profile is registered at runtime init.

## Related

-   `useSidebarPages`, `usePaneApps`, `useDashboardPlugins` — inventory sources.
-   `useWorkspaceManager` — the active workspace the selection is scoped to.
