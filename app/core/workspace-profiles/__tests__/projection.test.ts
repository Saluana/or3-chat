import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_WORKSPACE_PROFILE_INVENTORY,
  STANDARD_OR3_PROFILE,
  projectProfileItems,
  resolveWorkspaceProfile,
  setResolvedWorkspaceProfile,
} from "..";

const limits = {
  maxDesktopPanes: 3,
  mobilePolicy: "single-pane" as const,
};

afterEach(() => {
  setResolvedWorkspaceProfile(
    resolveWorkspaceProfile(
      STANDARD_OR3_PROFILE,
      DEFAULT_WORKSPACE_PROFILE_INVENTORY,
      limits,
    ),
  );
});

describe("workspace profile surface projection", () => {
  it("feeds navigation, dashboard, commands and mobile from one resolved result", () => {
    const inventory = {
      navigation: [
        { id: "sidebar-home" },
        { id: "plugin-page" },
        { id: "hidden-page" },
      ],
      dashboard: [{ id: "core:settings" }, { id: "plugin-dashboard" }],
      panes: [{ id: "chat" }],
      commands: [
        { id: "new-chat" },
        { id: "plugin-command" },
        { id: "hidden-command" },
      ],
    };
    setResolvedWorkspaceProfile(
      resolveWorkspaceProfile(
        {
          schemaVersion: 1,
          id: "projection-test",
          label: "Projection test",
          navigation: {
            order: ["plugin-page", "sidebar-home"],
            hidden: ["hidden-page"],
          },
          dashboard: {
            order: ["plugin-dashboard"],
            hidden: ["core:settings"],
          },
          commands: {
            order: ["plugin-command", "new-chat"],
            hidden: ["hidden-command"],
          },
          mobile: {
            bottomNavigation: ["sidebar-home"],
          },
        },
        inventory,
        limits,
      ),
    );

    expect(
      projectProfileItems("navigation", inventory.navigation).map(
        ({ id }) => id,
      ),
    ).toEqual(["plugin-page", "sidebar-home"]);
    expect(
      projectProfileItems("dashboard", inventory.dashboard).map(({ id }) => id),
    ).toEqual(["plugin-dashboard"]);
    expect(
      projectProfileItems("commands", inventory.commands).map(({ id }) => id),
    ).toEqual(["plugin-command", "new-chat"]);
    expect(
      projectProfileItems("mobile-bottom-navigation", inventory.navigation).map(
        ({ id }) => id,
      ),
    ).toEqual(["sidebar-home"]);
  });

  it("temporarily appends a newly registered item until runtime resolution catches up", () => {
    const resolved = resolveWorkspaceProfile(
      STANDARD_OR3_PROFILE,
      DEFAULT_WORKSPACE_PROFILE_INVENTORY,
      limits,
    );
    setResolvedWorkspaceProfile(resolved);

    expect(
      projectProfileItems("dashboard", [
        ...DEFAULT_WORKSPACE_PROFILE_INVENTORY.dashboard,
        { id: "late-plugin" },
      ]).map(({ id }) => id),
    ).toEqual(["core:settings", "core:images", "late-plugin"]);
  });
});
