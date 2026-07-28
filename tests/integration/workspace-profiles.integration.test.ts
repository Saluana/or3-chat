import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetWorkspaceProfileRegistryForTests,
  getWorkspaceProfile,
} from "~/core/workspace-profiles";
import {
  WORKSPACE_PROFILE_INITIAL_PANES_KEY,
  WORKSPACE_PROFILE_SELECTION_KEY,
} from "~/core/workspace-profiles/selection";
import {
  __resetWorkspaceProfileRuntimeForTests,
  applyProfile,
  registerBuiltinWorkspaceProfiles,
  reloadWorkspaceProfile,
  resetToStandard,
  useWorkspaceProfiles,
} from "~/composables/workspace-profiles/useWorkspaceProfiles";
import { getDb, setActiveWorkspaceDb } from "~/db/client";
import { getKvByName, setKvByName } from "~/db/kv";
import { createHookEngine } from "~/core/hooks/hooks";
import { createTypedHookEngine } from "~/core/hooks/typed-hooks";

describe("workspace profile workspace isolation", () => {
  const suffix = crypto.randomUUID();
  const workspaceA = `profile-a-${suffix}`;
  const workspaceB = `profile-b-${suffix}`;
  const workspaceC = `profile-c-${suffix}`;
  const originalUseNuxtApp = (
    globalThis as typeof globalThis & { useNuxtApp?: () => unknown }
  ).useNuxtApp;
  let handles: ReturnType<typeof registerBuiltinWorkspaceProfiles> = [];

  beforeEach(() => {
    const hooks = createTypedHookEngine(createHookEngine());
    (
      globalThis as typeof globalThis & {
        useNuxtApp?: () => { $hooks: typeof hooks };
      }
    ).useNuxtApp = () => ({ $hooks: hooks });
    __resetWorkspaceProfileRegistryForTests();
    __resetWorkspaceProfileRuntimeForTests();
    handles = registerBuiltinWorkspaceProfiles();
  });

  afterEach(() => {
    for (const handle of handles) handle.dispose();
    setActiveWorkspaceDb(null);
    const root = globalThis as typeof globalThis & {
      useNuxtApp?: () => unknown;
    };
    if (originalUseNuxtApp) root.useNuxtApp = originalUseNuxtApp;
    else delete root.useNuxtApp;
  });

  it("persists selection per active workspace and preserves unrelated data on reset", async () => {
    setActiveWorkspaceDb(workspaceA);
    await setKvByName(WORKSPACE_PROFILE_INITIAL_PANES_KEY, "1");
    await setKvByName("profile-test-sentinel", "keep");
    await applyProfile("minimal-chat");
    expect((await getKvByName(WORKSPACE_PROFILE_SELECTION_KEY))?.value).toBe(
      "minimal-chat",
    );

    setActiveWorkspaceDb(workspaceB);
    await setKvByName(WORKSPACE_PROFILE_INITIAL_PANES_KEY, "1");
    await reloadWorkspaceProfile();
    expect(useWorkspaceProfiles().selectedProfileId.value).toBe("standard-or3");
    await applyProfile("document-workspace");

    setActiveWorkspaceDb(workspaceA);
    await reloadWorkspaceProfile();
    const runtime = useWorkspaceProfiles();
    expect(runtime.selectedProfileId.value).toBe("minimal-chat");

    await resetToStandard({ resetLayout: true });
    expect((await getKvByName("profile-test-sentinel"))?.value).toBe("keep");
    expect((await getKvByName(WORKSPACE_PROFILE_SELECTION_KEY))?.value).toBe(
      "standard-or3",
    );
    expect(runtime.initialPaneRequest.value).toMatchObject({
      profileId: "standard-or3",
      replaceExisting: true,
      reason: "reset-layout",
    });
    expect(getWorkspaceProfile("standard-or3")).toBeDefined();
    expect(getDb().name).toBe(`or3-db-${workspaceA}`);
  });

  it("requests initial panes only once for a newly created workspace", async () => {
    setActiveWorkspaceDb(workspaceC);
    await reloadWorkspaceProfile();

    const runtime = useWorkspaceProfiles();
    expect(runtime.initialPaneRequest.value).toMatchObject({
      profileId: "standard-or3",
      replaceExisting: false,
      reason: "new-workspace",
    });

    const token = runtime.initialPaneRequest.value?.token;
    expect(token).toBeTypeOf("number");
    await runtime.acknowledgeInitialPanes(token!);
    expect(runtime.initialPaneRequest.value).toBeNull();

    __resetWorkspaceProfileRuntimeForTests();
    await reloadWorkspaceProfile();
    expect(useWorkspaceProfiles().initialPaneRequest.value).toBeNull();
    expect(
      (await getKvByName(WORKSPACE_PROFILE_INITIAL_PANES_KEY))?.value,
    ).toBe("1");
  });
});
