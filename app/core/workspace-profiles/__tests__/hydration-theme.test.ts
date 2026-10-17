import { beforeEach, describe, expect, it } from "vitest";
import { compileThemeDefinition } from "~/theme/_shared/compile-theme";
import { validateThemeDefinition } from "~/theme/_shared/validate-theme";
import {
  __resetWorkspaceProfileRegistryForTests,
  activeThemeProfileRecommendation,
  createWorkspaceProfileHydrationPayload,
  DOCUMENT_WORKSPACE_PROFILE,
  getWorkspaceProfile,
  hydrateWorkspaceProfilePayload,
  selectWorkspaceProfileForBootstrap,
  serializeWorkspaceProfileSelectionCookie,
  registerThemeWorkspaceProfiles,
  resolvedWorkspaceProfile,
  setResolvedWorkspaceProfile,
  STANDARD_OR3_PROFILE,
} from "..";
import { DEFAULT_WORKSPACE_PROFILE_INVENTORY } from "../projection";

const limits = {
  maxDesktopPanes: 3,
  mobilePolicy: "single-pane" as const,
};

const themeProfile = {
  schemaVersion: 1 as const,
  id: "theme-focus",
  label: "Theme Focus",
  navigation: { order: ["sidebar-chats", "sidebar-home"] },
};

describe("workspace profile hydration and theme packaging", () => {
  beforeEach(() => {
    __resetWorkspaceProfileRegistryForTests();
    activeThemeProfileRecommendation.value = null;
  });

  it("hydrates a non-Standard workspace from its server-readable selection mirror", () => {
    const cookieValue = encodeURIComponent(
      serializeWorkspaceProfileSelectionCookie(
        "workspace-a",
        DOCUMENT_WORKSPACE_PROFILE.id,
      ),
    );
    const cookieHeader = `unrelated=1; or3_workspace_profile_v1=${cookieValue}`;
    const serverProfile = selectWorkspaceProfileForBootstrap({
      cookieHeader,
      workspaceId: "workspace-a",
    });
    const payload = createWorkspaceProfileHydrationPayload(
      serverProfile,
      DEFAULT_WORKSPACE_PROFILE_INVENTORY,
      limits,
    );
    const serverResult = hydrateWorkspaceProfilePayload(payload);
    const clientResult = hydrateWorkspaceProfilePayload(
      JSON.parse(JSON.stringify(payload)),
    );

    expect(serverResult.id).toBe("document-workspace");
    expect(serverResult.workspace.initialPanes).toEqual([
      { id: "doc" },
      { id: "chat" },
    ]);
    expect(clientResult).toEqual(serverResult);
    expect(
      selectWorkspaceProfileForBootstrap({
        cookieHeader,
        workspaceId: "workspace-b",
      }).id,
    ).toBe("standard-or3");
  });

  it("registers valid theme profiles as choices and never applies the recommendation", () => {
    const current = hydrateWorkspaceProfilePayload(
      createWorkspaceProfileHydrationPayload(
        STANDARD_OR3_PROFILE,
        DEFAULT_WORKSPACE_PROFILE_INVENTORY,
        limits,
      ),
    );
    setResolvedWorkspaceProfile(current);

    const registration = registerThemeWorkspaceProfiles("calm-theme", {
      workspaceProfiles: [themeProfile],
      recommendedWorkspaceProfileId: themeProfile.id,
    });

    expect(getWorkspaceProfile(themeProfile.id)?.source).toEqual({
      kind: "theme",
      id: "calm-theme",
    });
    expect(activeThemeProfileRecommendation.value).toEqual({
      themeId: "calm-theme",
      profileId: themeProfile.id,
    });
    expect(resolvedWorkspaceProfile.value.id).toBe("standard-or3");

    registration.dispose();
    expect(getWorkspaceProfile(themeProfile.id)).toBeUndefined();
    expect(activeThemeProfileRecommendation.value).toBeNull();
  });

  it("rejects invalid bundles and preserves validated fields through compilation", () => {
    expect(() =>
      registerThemeWorkspaceProfiles("unsafe-theme", {
        workspaceProfiles: [
          {
            ...themeProfile,
            onApply: () => undefined,
          },
        ],
      }),
    ).toThrow(/Invalid workspace profile/);

    const definition = {
      name: "profile-theme",
      colors: {
        primary: "#123456",
        secondary: "#234567",
        surface: "#ffffff",
      },
      workspaceProfiles: [themeProfile],
      recommendedWorkspaceProfileId: themeProfile.id,
    };
    expect(validateThemeDefinition(definition).valid).toBe(true);
    expect(compileThemeDefinition(definition)).toMatchObject({
      workspaceProfiles: [themeProfile],
      recommendedWorkspaceProfileId: themeProfile.id,
    });

    const invalid = validateThemeDefinition({
      ...definition,
      recommendedWorkspaceProfileId: "not-bundled",
    });
    expect(invalid.valid).toBe(false);
    expect(invalid.errors).toContainEqual(
      expect.objectContaining({ code: "THEME_024" }),
    );
  });
});
