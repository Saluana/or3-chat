import type { WorkspaceProfileInitialPane } from "./schema";

export const WORKSPACE_PROFILE_SELECTION_KEY = "workspace_profile.selected_v1";
export const WORKSPACE_PROFILE_INITIAL_PANES_KEY =
  "workspace_profile.initial_panes_applied_v1";

export interface WorkspaceProfilePreferenceStore {
  get(name: string): Promise<string | null | undefined>;
  set(name: string, value: string | null): Promise<void>;
}

export interface WorkspaceProfileInitialPaneRequest {
  readonly token: number;
  readonly workspaceId: string | null;
  readonly profileId: string;
  readonly panes: readonly WorkspaceProfileInitialPane[];
  readonly replaceExisting: boolean;
  readonly reason: "new-workspace" | "reset-layout";
}

export function needsInitialPaneApplication(
  storedMarker: string | null | undefined,
): boolean {
  return storedMarker !== "1";
}

export async function markInitialPanesApplied(
  store: WorkspaceProfilePreferenceStore,
): Promise<void> {
  await store.set(WORKSPACE_PROFILE_INITIAL_PANES_KEY, "1");
}
