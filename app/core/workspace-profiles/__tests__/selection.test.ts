import { describe, expect, it } from "vitest";
import {
  WORKSPACE_PROFILE_INITIAL_PANES_KEY,
  markInitialPanesApplied,
  needsInitialPaneApplication,
  type WorkspaceProfilePreferenceStore,
} from "../selection";

describe("workspace profile initial-pane policy", () => {
  it("applies only when a workspace has no completion marker", async () => {
    const values = new Map<string, string | null>();
    const store: WorkspaceProfilePreferenceStore = {
      get: async (name) => values.get(name),
      set: async (name, value) => {
        values.set(name, value);
      },
    };
    expect(
      needsInitialPaneApplication(
        await store.get(WORKSPACE_PROFILE_INITIAL_PANES_KEY),
      ),
    ).toBe(true);
    await markInitialPanesApplied(store);
    expect(
      needsInitialPaneApplication(
        await store.get(WORKSPACE_PROFILE_INITIAL_PANES_KEY),
      ),
    ).toBe(false);
  });
});
