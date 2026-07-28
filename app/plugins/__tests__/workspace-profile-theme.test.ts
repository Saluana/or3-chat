import { nextTick, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetWorkspaceProfileRegistryForTests,
  activeThemeProfileRecommendation,
  getWorkspaceProfile,
} from "~/core/workspace-profiles";

describe("theme workspace profile plugin lifecycle", () => {
  beforeEach(() => {
    __resetWorkspaceProfileRegistryForTests();
    activeThemeProfileRecommendation.value = null;
  });

  it("keeps installed-theme profiles available across theme switches and disposes on app teardown", async () => {
    const activeTheme = ref("theme-a");
    const definitions = {
      "theme-a": {
        workspaceProfiles: [
          {
            schemaVersion: 1 as const,
            id: "theme-a-profile",
            label: "Theme A profile",
          },
        ],
        recommendedWorkspaceProfileId: "theme-a-profile",
      },
      "theme-b": {
        workspaceProfiles: [
          {
            schemaVersion: 1 as const,
            id: "theme-b-profile",
            label: "Theme B profile",
          },
        ],
        recommendedWorkspaceProfileId: "theme-b-profile",
      },
    };
    const theme = {
      activeTheme,
      availableThemes: [{ name: "theme-a" }, { name: "theme-b" }],
      loadTheme: vi.fn(
        async (name: keyof typeof definitions) => definitions[name],
      ),
      getTheme: (name: keyof typeof definitions) => definitions[name],
    };
    let beforeUnmount: (() => void) | undefined;
    const nuxtApp = {
      hook: (name: string, callback: () => void) => {
        if (name === "app:beforeUnmount") beforeUnmount = callback;
      },
    };
    (
      globalThis as typeof globalThis & {
        useNuxtApp?: () => { $theme: typeof theme };
        defineNuxtPlugin?: (
          plugin: (app: typeof nuxtApp) => unknown,
        ) => unknown;
      }
    ).useNuxtApp = () => ({ $theme: theme });
    (
      globalThis as typeof globalThis & {
        defineNuxtPlugin?: (
          plugin: (app: typeof nuxtApp) => unknown,
        ) => unknown;
      }
    ).defineNuxtPlugin = (plugin) => plugin(nuxtApp);

    await import("~/plugins/92.workspace-profile-theme.client");
    await vi.waitFor(() => {
      expect(getWorkspaceProfile("theme-a-profile")).toBeDefined();
      expect(getWorkspaceProfile("theme-b-profile")).toBeDefined();
    });
    expect(activeThemeProfileRecommendation.value).toEqual({
      themeId: "theme-a",
      profileId: "theme-a-profile",
    });

    activeTheme.value = "theme-b";
    await nextTick();
    await vi.waitFor(() => {
      expect(activeThemeProfileRecommendation.value).toEqual({
        themeId: "theme-b",
        profileId: "theme-b-profile",
      });
    });
    expect(getWorkspaceProfile("theme-a-profile")).toBeDefined();

    expect(beforeUnmount).toBeTypeOf("function");
    beforeUnmount?.();
    expect(getWorkspaceProfile("theme-a-profile")).toBeUndefined();
    expect(getWorkspaceProfile("theme-b-profile")).toBeUndefined();
    expect(activeThemeProfileRecommendation.value).toBeNull();
  });
});
