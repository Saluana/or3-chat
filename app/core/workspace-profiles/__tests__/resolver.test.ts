import { describe, expect, it } from "vitest";
import {
  BUILTIN_WORKSPACE_PROFILES,
  CODING_WORKSPACE_PROFILE,
  STANDARD_OR3_PROFILE,
} from "../builtins";
import { resolveWorkspaceProfile } from "../resolver";
import { WorkspaceProfileV1Schema } from "../schema";
import type { WorkspaceProfileInventory } from "../types";

const inventory: WorkspaceProfileInventory = {
  navigation: [
    { id: "sidebar-home" },
    { id: "sidebar-chats" },
    { id: "sidebar-docs" },
    { id: "plugin-page" },
  ],
  dashboard: [
    { id: "core:settings" },
    { id: "core:images" },
    { id: "plugin-dashboard" },
  ],
  panes: [{ id: "chat" }, { id: "doc" }, { id: "plugin-pane" }],
  commands: [
    { id: "new-chat" },
    { id: "new-document" },
    { id: "plugin-command" },
  ],
};

const limits = {
  maxDesktopPanes: 3,
  mobilePolicy: "single-pane" as const,
};

describe("resolveWorkspaceProfile", () => {
  it("hides, orders, appends and diagnoses unknown ids without mutating inputs", () => {
    const profile = {
      schemaVersion: 1 as const,
      id: "projection",
      label: "Projection",
      navigation: {
        order: ["plugin-page", "missing", "sidebar-home"],
        hidden: ["sidebar-docs", "missing-hidden"],
        groups: [
          {
            id: "primary",
            label: "Primary",
            items: ["plugin-page", "sidebar-home"],
          },
        ],
      },
      dashboard: {
        order: ["plugin-dashboard"],
        hidden: ["core:images"],
      },
      workspace: {
        initialPanes: [{ id: "plugin-pane" }, { id: "missing-pane" }],
        desktopPaneLimit: 9,
      },
      commands: {
        pinned: ["plugin-command", "missing-command"],
        order: ["plugin-command"],
        hidden: ["new-document"],
      },
      mobile: {
        bottomNavigation: ["sidebar-home", "missing-mobile"],
        defaultPageId: "missing-mobile",
      },
    };
    const snapshot = structuredClone(profile);
    const result = resolveWorkspaceProfile(profile, inventory, limits);

    expect(profile).toEqual(snapshot);
    expect(result.navigation.items).toEqual([
      "plugin-page",
      "sidebar-home",
      "sidebar-chats",
    ]);
    expect(result.dashboard.items).toEqual([
      "plugin-dashboard",
      "core:settings",
    ]);
    expect(result.commands.items).toEqual(["plugin-command", "new-chat"]);
    expect(result.commands.pinned).toEqual(["plugin-command"]);
    expect(result.workspace.initialPanes).toEqual([{ id: "plugin-pane" }]);
    expect(result.workspace.desktopPaneLimit).toBe(3);
    expect(result.mobile.bottomNavigation).toEqual(["sidebar-home"]);
    expect(result.mobile.defaultPageId).toBe("sidebar-home");
    expect(result.diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "unknown-navigation",
        "unknown-pane",
        "unknown-command",
        "invalid-default-page",
        "pane-limit-clamped",
      ]),
    );
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.navigation.items)).toBe(true);
    expect(Object.isFrozen(result.diagnostics)).toBe(true);
  });

  it("falls back safely to Standard OR3 for invalid or missing selections", () => {
    const invalid = resolveWorkspaceProfile(
      { id: "broken", schemaVersion: 2 },
      inventory,
      limits,
    );
    expect(invalid.id).toBe("standard-or3");
    expect(invalid.usedFallback).toBe(true);
    expect(invalid.navigation.items).toEqual(
      inventory.navigation.map((item) => item.id),
    );

    const missing = resolveWorkspaceProfile(undefined, inventory, limits, {
      missingProfileId: "missing-profile",
    });
    expect(missing.sourceProfileId).toBe("missing-profile");
    expect(missing.diagnostics[0]?.code).toBe("missing-profile");
  });

  it("keeps Standard OR3 in exact registry order with deployment defaults", () => {
    const result = resolveWorkspaceProfile(
      STANDARD_OR3_PROFILE,
      inventory,
      limits,
    );
    expect(result.navigation.items).toEqual(
      inventory.navigation.map((item) => item.id),
    );
    expect(result.dashboard.items).toEqual(
      inventory.dashboard.map((item) => item.id),
    );
    expect(result.commands.items).toEqual(
      inventory.commands.map((item) => item.id),
    );
    expect(result.navigation.defaultPageId).toBe("sidebar-home");
    expect(result.workspace.initialPanes).toEqual([{ id: "chat" }]);
    expect(result.usedFallback).toBe(false);
  });

  it("ships four valid built-ins and degrades Coding Workspace without agents", () => {
    for (const profile of BUILTIN_WORKSPACE_PROFILES) {
      expect(WorkspaceProfileV1Schema.safeParse(profile).success).toBe(true);
    }
    const result = resolveWorkspaceProfile(
      CODING_WORKSPACE_PROFILE,
      inventory,
      limits,
    );
    expect(result.workspace.initialPanes).toEqual([{ id: "chat" }]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "unknown-pane",
        id: "or3-external-agent",
      }),
    );
  });
});
