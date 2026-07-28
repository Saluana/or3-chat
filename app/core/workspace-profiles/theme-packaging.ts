import { shallowRef } from "vue";
import type { RegistrationHandle } from "~~/shared/plugins/registration-handle";
import { WorkspaceProfileV1Schema, type WorkspaceProfileV1 } from "./schema";
import { registerWorkspaceProfileBatch } from "./registry";

export interface ThemeWorkspaceProfileBundle {
  readonly workspaceProfiles?: readonly unknown[];
  readonly recommendedWorkspaceProfileId?: string;
}

export interface ParsedThemeWorkspaceProfileBundle {
  readonly profiles: readonly WorkspaceProfileV1[];
  readonly recommendedProfileId: string | null;
}

export interface ThemeWorkspaceProfileRegistration {
  readonly handles: readonly RegistrationHandle[];
  readonly recommendedProfileId: string | null;
  dispose(): void;
}

export const activeThemeProfileRecommendation = shallowRef<{
  themeId: string;
  profileId: string;
} | null>(null);

export function parseThemeWorkspaceProfileBundle(
  input: ThemeWorkspaceProfileBundle,
): ParsedThemeWorkspaceProfileBundle {
  const profiles = (input.workspaceProfiles ?? []).map((profile, index) => {
    const parsed = WorkspaceProfileV1Schema.safeParse(profile);
    if (!parsed.success) {
      throw new Error(
        `Invalid workspace profile at workspaceProfiles[${index}]: ${parsed.error.issues[0]?.message ?? "invalid profile"}`,
      );
    }
    return parsed.data;
  });
  const ids = new Set(profiles.map((profile) => profile.id));
  const recommended = input.recommendedWorkspaceProfileId;
  if (recommended && !ids.has(recommended)) {
    throw new Error(
      `Recommended workspace profile "${recommended}" is not bundled by this theme`,
    );
  }
  return Object.freeze({
    profiles: Object.freeze(profiles),
    recommendedProfileId: recommended ?? null,
  });
}

export function registerThemeWorkspaceProfiles(
  themeId: string,
  bundle: ThemeWorkspaceProfileBundle,
  options: { publishRecommendation?: boolean } = {},
): ThemeWorkspaceProfileRegistration {
  const parsed = parseThemeWorkspaceProfileBundle(bundle);
  const handles = registerWorkspaceProfileBatch(parsed.profiles, {
    source: { kind: "theme", id: themeId },
  });
  const publishesRecommendation = options.publishRecommendation !== false;
  if (publishesRecommendation) {
    activeThemeProfileRecommendation.value = parsed.recommendedProfileId
      ? { themeId, profileId: parsed.recommendedProfileId }
      : null;
  }
  let disposed = false;
  return {
    handles,
    recommendedProfileId: parsed.recommendedProfileId,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const handle of [...handles].reverse()) handle.dispose();
      if (
        publishesRecommendation &&
        activeThemeProfileRecommendation.value?.themeId === themeId
      ) {
        activeThemeProfileRecommendation.value = null;
      }
    },
  };
}
