import type { WorkspaceResource } from "~/core/workspace-tabs/types";

export interface WorkspaceTabsApi {
  reconcilePaneResource: (
    paneId: string,
    resource: WorkspaceResource,
    options?: { allowDuplicate?: boolean; replaceCurrent?: boolean },
  ) => string | null;
}

type GlobalWorkspaceTabs = typeof globalThis & {
  __or3WorkspaceTabsApi?: WorkspaceTabsApi;
};

export function getGlobalWorkspaceTabsApi(): WorkspaceTabsApi | undefined {
  return (globalThis as GlobalWorkspaceTabs).__or3WorkspaceTabsApi;
}

export function setGlobalWorkspaceTabsApi(
  api: WorkspaceTabsApi | undefined,
): void {
  (globalThis as GlobalWorkspaceTabs).__or3WorkspaceTabsApi = api;
}
