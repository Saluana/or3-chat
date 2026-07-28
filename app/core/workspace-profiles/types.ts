import type { WorkspaceProfileV1 } from "./schema";

export type WorkspaceProfileSource =
  | { kind: "core"; id: "or3" }
  | { kind: "plugin"; id: string }
  | { kind: "theme"; id: string };

export interface RegisteredWorkspaceProfile {
  readonly profile: WorkspaceProfileV1;
  readonly source: WorkspaceProfileSource;
}

export interface WorkspaceProfileInventoryItem {
  readonly id: string;
  readonly label?: string;
}

export interface WorkspaceProfileInventory {
  readonly navigation: readonly WorkspaceProfileInventoryItem[];
  readonly dashboard: readonly WorkspaceProfileInventoryItem[];
  readonly panes: readonly WorkspaceProfileInventoryItem[];
  readonly commands: readonly WorkspaceProfileInventoryItem[];
}

export interface WorkspaceProfileDeploymentLimits {
  readonly maxDesktopPanes: number;
  readonly mobilePolicy: "single-pane";
}

export type WorkspaceProfileDiagnosticCode =
  | "invalid-profile"
  | "missing-profile"
  | "unknown-navigation"
  | "unknown-dashboard"
  | "unknown-pane"
  | "unknown-command"
  | "invalid-default-page"
  | "pane-limit-clamped"
  | "fallback-standard";

export interface WorkspaceProfileDiagnostic {
  readonly code: WorkspaceProfileDiagnosticCode;
  readonly message: string;
  readonly path?: string;
  readonly id?: string;
}

export interface ResolvedWorkspaceProfileGroup {
  readonly id: string;
  readonly label: string;
  readonly items: readonly string[];
}

export interface ResolvedWorkspaceProfile {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly sourceProfileId: string;
  readonly usedFallback: boolean;
  readonly navigation: {
    readonly items: readonly string[];
    readonly hidden: readonly string[];
    readonly groups: readonly ResolvedWorkspaceProfileGroup[];
    readonly defaultPageId: string | null;
  };
  readonly dashboard: {
    readonly items: readonly string[];
    readonly hidden: readonly string[];
  };
  readonly workspace: {
    readonly initialPanes: readonly { id: string; recordId?: string }[];
    readonly desktopPaneLimit: number;
    readonly mobilePolicy: "single-pane";
  };
  readonly commands: {
    readonly items: readonly string[];
    readonly pinned: readonly string[];
    readonly hidden: readonly string[];
  };
  readonly mobile: {
    readonly bottomNavigation: readonly string[];
    readonly defaultPageId: string | null;
  };
  readonly diagnostics: readonly WorkspaceProfileDiagnostic[];
}
