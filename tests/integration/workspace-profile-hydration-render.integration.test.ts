import { renderToString } from "@vue/server-renderer";
import {
  createSSRApp,
  defineComponent,
  h,
  nextTick,
  shallowRef,
  type ShallowRef,
} from "vue";
import { describe, expect, it } from "vitest";
import {
  __getRequestResolvedWorkspaceProfileRefForTests,
  createWorkspaceProfileHydrationPayload,
  DEFAULT_WORKSPACE_PROFILE_INVENTORY,
  DOCUMENT_WORKSPACE_PROFILE,
  hydrateWorkspaceProfilePayload,
  setRequestResolvedWorkspaceProfile,
  type ResolvedWorkspaceProfile,
} from "~/core/workspace-profiles";

function profileShell(profile: ShallowRef<ResolvedWorkspaceProfile>) {
  return defineComponent({
    name: "WorkspaceProfileHydrationProbe",
    setup() {
      return () =>
        h(
          "main",
          {
            "data-profile": profile.value.id,
            "data-default-page":
              profile.value.mobile.defaultPageId ??
              profile.value.navigation.defaultPageId,
            "data-pane-limit": profile.value.workspace.desktopPaneLimit,
          },
          profile.value.mobile.bottomNavigation.map((id) =>
            h("a", { href: `#${id}`, "data-nav-id": id }, id),
          ),
        );
    },
  });
}

describe("workspace profile rendered hydration", () => {
  it("hydrates the serialized SSR projection without fallback markup or rearrangement", async () => {
    const payload = createWorkspaceProfileHydrationPayload(
      DOCUMENT_WORKSPACE_PROFILE,
      DEFAULT_WORKSPACE_PROFILE_INVENTORY,
      { maxDesktopPanes: 3, mobilePolicy: "single-pane" },
    );
    const serverRequest = {};
    setRequestResolvedWorkspaceProfile(
      serverRequest,
      hydrateWorkspaceProfilePayload(payload),
    );
    const serverProfile =
      __getRequestResolvedWorkspaceProfileRefForTests(serverRequest);
    const serverHtml = await renderToString(
      createSSRApp(profileShell(serverProfile)),
    );

    const container = document.createElement("div");
    container.innerHTML = serverHtml;
    const initialMarkup = container.innerHTML;
    const clientProfile = shallowRef(
      hydrateWorkspaceProfilePayload(
        JSON.parse(JSON.stringify(payload)) as unknown,
      ),
    );
    const warnings: string[] = [];
    const clientApp = createSSRApp(profileShell(clientProfile));
    clientApp.config.warnHandler = (message) => warnings.push(message);

    clientApp.mount(container);
    await nextTick();

    expect(clientProfile.value).toEqual(serverProfile.value);
    expect(clientProfile.value.usedFallback).toBe(false);
    expect(container.innerHTML).toBe(initialMarkup);
    expect(container.querySelector("main")?.dataset.profile).toBe(
      "document-workspace",
    );
    expect(
      [...container.querySelectorAll("[data-nav-id]")].map((node) =>
        node.getAttribute("data-nav-id"),
      ),
    ).toEqual(["sidebar-docs", "sidebar-home", "sidebar-chats"]);
    expect(
      warnings.filter((warning) => /hydration|mismatch/i.test(warning)),
    ).toEqual([]);

    clientApp.unmount();
  });
});
