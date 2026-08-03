import type { UseMultiPaneApi } from "~/composables/core/useMultiPane";
import { getGlobalWorkspaceTabsApi } from "~/utils/workspaceTabsApi";
import { EXTERNAL_AGENT_PANE_APP_ID } from "./refs";

/**
 * Apply an external-agent pane mutation and adopt it in the workspace tab
 * manifest in the same turn. The watcher in PageShell remains a compatibility
 * fallback for older plugins, but callers that replace the launcher use this
 * helper so the launcher tab cannot race into a second blank tab.
 */
export async function setExternalAgentPaneRecord(
  api: UseMultiPaneApi,
  index: number,
  recordId: string,
): Promise<void> {
  await api.setPaneApp(index, EXTERNAL_AGENT_PANE_APP_ID, { recordId });
  const pane = api.panes.value[index];
  if (!pane) return;
  getGlobalWorkspaceTabsApi()?.reconcilePaneResource(
    pane.id,
    { kind: "app", appId: EXTERNAL_AGENT_PANE_APP_ID, recordId },
    { replaceCurrent: true },
  );
}
