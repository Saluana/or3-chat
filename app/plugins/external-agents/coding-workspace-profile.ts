import type { WorkspaceProfileV1 } from "~/core/workspace-profiles/schema";

export const CODING_WORKSPACE_PROFILE: WorkspaceProfileV1 = {
  schemaVersion: 1,
  id: "coding-workspace",
  label: "Coding Workspace",
  description: "A coding-oriented layout with External Agents.",
  navigation: {
    defaultPageId: "sidebar-home",
    order: ["or3-external-agents", "or3-workflows-page", "sidebar-chats", "sidebar-home"],
  },
  dashboard: { order: ["or3:activity"] },
  workspace: {
    initialPanes: [{ id: "chat" }, { id: "or3-external-agent" }],
    desktopPaneLimit: 3,
    mobilePolicy: "single-pane",
  },
  commands: {
    pinned: ["external-agent-new-session", "new-chat"],
    order: ["external-agent-new-session", "external-agent-running", "external-agent-approvals", "external-agent-reconnect", "new-chat"],
  },
  mobile: {
    bottomNavigation: ["or3-external-agents", "sidebar-chats", "sidebar-home"],
    defaultPageId: "sidebar-home",
  },
};
