import type { WorkspaceProfileV1 } from "./schema";

export const STANDARD_OR3_PROFILE_ID = "standard-or3";

export const STANDARD_OR3_PROFILE: WorkspaceProfileV1 = {
  schemaVersion: 1,
  id: STANDARD_OR3_PROFILE_ID,
  label: "Standard OR3",
  description: "The complete OR3 workspace with every available contribution.",
  navigation: {
    defaultPageId: "sidebar-home",
  },
  workspace: {
    initialPanes: [{ id: "chat" }],
    desktopPaneLimit: 3,
    mobilePolicy: "single-pane",
  },
  mobile: {
    defaultPageId: "sidebar-home",
  },
};

export const MINIMAL_CHAT_PROFILE: WorkspaceProfileV1 = {
  schemaVersion: 1,
  id: "minimal-chat",
  label: "Minimal Chat",
  description: "A focused chat workspace with lightweight navigation.",
  navigation: {
    defaultPageId: "sidebar-chats",
    order: ["sidebar-chats", "sidebar-home"],
    hidden: [
      "sidebar-docs",
      "or3-workflows-page",
      "or3-external-agents",
    ],
  },
  dashboard: {
    hidden: ["core:images", "or3:activity"],
  },
  workspace: {
    initialPanes: [{ id: "chat" }],
    desktopPaneLimit: 2,
    mobilePolicy: "single-pane",
  },
  commands: {
    pinned: ["new-chat"],
    order: ["new-chat", "open-dashboard"],
    hidden: ["new-document", "open-image-library"],
  },
  mobile: {
    bottomNavigation: ["sidebar-chats", "sidebar-home"],
    defaultPageId: "sidebar-chats",
  },
};

export const DOCUMENT_WORKSPACE_PROFILE: WorkspaceProfileV1 = {
  schemaVersion: 1,
  id: "document-workspace",
  label: "Document Workspace",
  description: "Documents first, while retaining the rest of your OR3 tools.",
  navigation: {
    defaultPageId: "sidebar-docs",
    order: ["sidebar-docs", "sidebar-home", "sidebar-chats"],
  },
  dashboard: {
    order: ["core:settings", "core:images"],
  },
  workspace: {
    initialPanes: [{ id: "doc" }, { id: "chat" }],
    desktopPaneLimit: 3,
    mobilePolicy: "single-pane",
  },
  commands: {
    pinned: ["new-document"],
    order: ["new-document", "new-chat", "open-dashboard"],
  },
  mobile: {
    bottomNavigation: ["sidebar-docs", "sidebar-home", "sidebar-chats"],
    defaultPageId: "sidebar-docs",
  },
};

export const CODING_WORKSPACE_PROFILE: WorkspaceProfileV1 = {
  schemaVersion: 1,
  id: "coding-workspace",
  label: "Coding Workspace",
  description:
    "A coding-oriented layout that adds External Agents when the capability is installed.",
  navigation: {
    defaultPageId: "sidebar-home",
    order: [
      "or3-external-agents",
      "or3-workflows-page",
      "sidebar-chats",
      "sidebar-home",
    ],
  },
  dashboard: {
    order: ["or3:activity"],
  },
  workspace: {
    initialPanes: [{ id: "chat" }, { id: "or3-external-agent" }],
    desktopPaneLimit: 3,
    mobilePolicy: "single-pane",
  },
  commands: {
    pinned: ["external-agent-new-session", "new-chat"],
    order: [
      "external-agent-new-session",
      "external-agent-running",
      "external-agent-approvals",
      "external-agent-reconnect",
      "new-chat",
    ],
  },
  mobile: {
    bottomNavigation: [
      "or3-external-agents",
      "sidebar-chats",
      "sidebar-home",
    ],
    defaultPageId: "sidebar-home",
  },
};

export const BUILTIN_WORKSPACE_PROFILES = Object.freeze([
  STANDARD_OR3_PROFILE,
  MINIMAL_CHAT_PROFILE,
  DOCUMENT_WORKSPACE_PROFILE,
  CODING_WORKSPACE_PROFILE,
] as const);
