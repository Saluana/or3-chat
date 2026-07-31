import {
  initializeWorkspaceProfilesRuntime,
  registerBuiltinWorkspaceProfiles,
  seedWorkspaceProfileRuntime,
} from "~/composables/workspace-profiles/useWorkspaceProfiles";
import {
  hydrateWorkspaceProfilePayload,
  setResolvedWorkspaceProfile,
} from "~/core/workspace-profiles";

export default defineNuxtPlugin((nuxtApp) => {
  const hydrationPayload = nuxtApp.payload.data.__or3WorkspaceProfile;
  if (hydrationPayload) {
    try {
      const hydrated = hydrateWorkspaceProfilePayload(hydrationPayload);
      setResolvedWorkspaceProfile(hydrated);
      seedWorkspaceProfileRuntime(hydrated.id);
    } catch (error) {
      if (import.meta.dev) {
        console.warn(
          "[workspace-profiles] Ignoring invalid hydration payload",
          error,
        );
      }
    }
  }
  const root = globalThis as typeof globalThis & {
    __or3BuiltinWorkspaceProfileHandles?: ReturnType<
      typeof registerBuiltinWorkspaceProfiles
    >;
  };
  for (const handle of root.__or3BuiltinWorkspaceProfileHandles ?? []) {
    handle.dispose();
  }
  const handles = registerBuiltinWorkspaceProfiles();
  root.__or3BuiltinWorkspaceProfileHandles = handles;
  const disposeRuntime = initializeWorkspaceProfilesRuntime();

  let disposed = false;
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    disposeRuntime();
    for (const handle of handles) handle.dispose();
    if (root.__or3BuiltinWorkspaceProfileHandles === handles) {
      delete root.__or3BuiltinWorkspaceProfileHandles;
    }
  };
  (
    nuxtApp.hook as unknown as (
      name: "app:beforeUnmount",
      callback: () => void,
    ) => void
  )("app:beforeUnmount", cleanup);
  if (import.meta.hot) {
    import.meta.hot.dispose(cleanup);
  }
});
