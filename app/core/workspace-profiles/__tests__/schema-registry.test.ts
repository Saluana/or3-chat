import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetWorkspaceProfileRegistryForTests,
  getWorkspaceProfile,
  listWorkspaceProfiles,
  registerWorkspaceProfile,
  unregisterWorkspaceProfile,
} from "../registry";
import { WorkspaceProfileV1Schema } from "../schema";

const profile = {
  schemaVersion: 1 as const,
  id: "test-profile",
  label: "Test profile",
  navigation: { order: ["sidebar-home"] },
};

describe("WorkspaceProfileV1 schema and registry", () => {
  beforeEach(() => {
    __resetWorkspaceProfileRegistryForTests();
  });

  it("accepts declarative V1 profiles and rejects unsupported executable fields", () => {
    expect(WorkspaceProfileV1Schema.parse(profile)).toEqual(profile);
    expect(
      WorkspaceProfileV1Schema.safeParse({
        ...profile,
        onApply: () => undefined,
      }).success,
    ).toBe(false);
    expect(
      WorkspaceProfileV1Schema.safeParse({
        ...profile,
        navigation: {
          order: ["sidebar-home"],
          render: "some-module",
        },
      }).success,
    ).toBe(false);
    expect(
      WorkspaceProfileV1Schema.safeParse({
        ...profile,
        schemaVersion: 2,
      }).success,
    ).toBe(false);
    expect(
      WorkspaceProfileV1Schema.safeParse({
        ...profile,
        navigation: {
          groups: [
            {
              id: "first",
              label: "First",
              items: ["sidebar-home"],
            },
            {
              id: "second",
              label: "Second",
              items: ["sidebar-home"],
            },
          ],
        },
      }).success,
    ).toBe(false);
  });

  it("enforces unique owned ids and exact-owner idempotent disposal", () => {
    const handle = registerWorkspaceProfile(profile, {
      source: { kind: "plugin", id: "tests" },
    });
    expect(listWorkspaceProfiles()).toHaveLength(1);
    expect(() =>
      registerWorkspaceProfile(profile, {
        source: { kind: "plugin", id: "other" },
      }),
    ).toThrow(/already owned/);
    expect(handle.dispose()).toBe(true);
    expect(handle.dispose()).toBe(false);
    expect(getWorkspaceProfile(profile.id)).toBeUndefined();
  });

  it("freezes registered input and supports clean HMR-style re-registration", () => {
    const input = {
      ...profile,
      navigation: { order: ["sidebar-home"] },
    };
    const first = registerWorkspaceProfile(input, {
      source: { kind: "plugin", id: "tests" },
    });
    input.navigation.order.push("late-mutation");
    expect(getWorkspaceProfile(profile.id)?.profile.navigation?.order).toEqual([
      "sidebar-home",
    ]);
    expect(
      Object.isFrozen(getWorkspaceProfile(profile.id)?.profile.navigation),
    ).toBe(true);

    first.dispose();
    const second = registerWorkspaceProfile(
      { ...profile, label: "Reloaded" },
      { source: { kind: "plugin", id: "tests" } },
    );
    expect(getWorkspaceProfile(profile.id)?.profile.label).toBe("Reloaded");
    second.dispose();
  });

  it("supports explicit id-based unregistration", () => {
    const handle = registerWorkspaceProfile(profile, {
      source: { kind: "plugin", id: "tests" },
    });
    expect(unregisterWorkspaceProfile(profile.id)).toBe(true);
    expect(unregisterWorkspaceProfile(profile.id)).toBe(false);
    expect(handle.dispose()).toBe(false);
  });
});
