import { mount } from "@vue/test-utils";
import { ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import WorkspaceProfileSettings from "../WorkspaceProfileSettings.vue";

const mocks = vi.hoisted(() => ({
  applyProfile: vi.fn(),
  resetToStandard: vi.fn(),
  toastAdd: vi.fn(),
}));

vi.mock("#imports", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#imports")>();
  return {
    ...actual,
    useToast: () => ({ add: mocks.toastAdd }),
    useRuntimeConfig: () => ({
      public: {
        features: {},
        or3: { site: {}, limits: {}, ui: {}, legal: {} },
      },
    }),
  };
});

vi.mock("~/composables/workspace-profiles/useWorkspaceProfiles", async () => {
  const { ref } = await import("vue");
  const profile = {
    schemaVersion: 1 as const,
    id: "standard-or3",
    label: "Standard OR3",
    description: "Complete workspace",
  };
  return {
    useWorkspaceProfiles: () => ({
      profiles: ref([
        {
          profile,
          source: { kind: "core" as const, id: "or3" as const },
        },
      ]),
      selectedProfileId: ref("standard-or3"),
      resolvedProfile: ref({
        id: "standard-or3",
        navigation: { items: ["sidebar-home"] },
        dashboard: { items: ["core:settings"] },
        workspace: {
          initialPanes: [{ id: "chat" }],
          desktopPaneLimit: 3,
          mobilePolicy: "single-pane",
        },
        commands: { items: ["new-chat"], pinned: [] },
        mobile: {
          bottomNavigation: ["sidebar-home"],
          defaultPageId: "sidebar-home",
        },
        diagnostics: [],
      }),
      pending: ref(false),
      inventory: ref({
        navigation: [
          { id: "sidebar-home", label: "Home" },
          { id: "sidebar-docs", label: "Docs" },
        ],
        dashboard: [{ id: "core:settings", label: "Settings" }],
        panes: [{ id: "chat", label: "Chat" }],
        commands: [{ id: "new-chat", label: "New chat" }],
      }),
      applyProfile: mocks.applyProfile,
      resetToStandard: mocks.resetToStandard,
    }),
  };
});

describe("WorkspaceProfileSettings", () => {
  beforeEach(() => {
    mocks.applyProfile.mockReset();
    mocks.resetToStandard.mockReset();
    mocks.toastAdd.mockReset();
  });

  it("shows source, description, summaries, Apply and confirmed Reset", async () => {
    const wrapper = mount(WorkspaceProfileSettings, {
      global: {
        stubs: {
          UFormField: { template: "<label><slot /></label>" },
          USelect: {
            props: ["modelValue"],
            template: "<select />",
          },
          UBadge: { template: "<span><slot /></span>" },
        },
      },
    });

    expect(wrapper.text()).toContain("Arrange existing OR3 surfaces");
    expect(wrapper.text()).toContain("Standard OR3");
    expect(wrapper.text()).toContain("Built in");
    expect(wrapper.text()).toContain("Complete workspace");
    expect(wrapper.text()).toContain("Active in this workspace");
    expect(wrapper.text()).toContain("Home, Docs");
    expect(wrapper.text()).toContain("Chat · up to 4 side by side");
    expect(wrapper.text()).toContain("New chat");
    expect(wrapper.text()).toContain("Apply profile");

    const resetButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("Reset to Standard"));
    await resetButton?.trigger("click");
    expect(
      wrapper.find('[data-testid="profile-reset-confirmation"]').exists(),
    ).toBe(true);

    const confirmButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("Confirm reset"));
    await confirmButton?.trigger("click");
    expect(mocks.resetToStandard).toHaveBeenCalledWith({
      resetLayout: true,
    });
  });
});
