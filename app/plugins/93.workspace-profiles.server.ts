import {
  createWorkspaceProfileHydrationPayload,
  DEFAULT_WORKSPACE_PROFILE_INVENTORY,
  hydrateWorkspaceProfilePayload,
  readWorkspaceProfileSelectionCookie,
  selectWorkspaceProfileForBootstrap,
  setRequestResolvedWorkspaceProfile,
} from "~/core/workspace-profiles";
import { useOr3Config } from "~/composables/useOr3Config";
import type { ThemePlugin } from "~/theme/_shared/types";
import { resolveSessionContext } from "~~/server/auth/session";

export default defineNuxtPlugin(async (nuxtApp) => {
  const config = useOr3Config();
  const runtimeConfig = useRuntimeConfig();
  const event = nuxtApp.ssrContext?.event;
  let workspaceId: string | null = null;
  if (event && runtimeConfig.public.ssrAuthEnabled === true) {
    try {
      const session = await resolveSessionContext(event);
      workspaceId =
        session.authenticated && session.workspace?.id
          ? session.workspace.id
          : null;
    } catch (error) {
      if (import.meta.dev) {
        console.warn(
          "[workspace-profiles] Could not resolve the SSR workspace",
          error,
        );
      }
    }
  }

  const cookieHeader = event?.node.req.headers.cookie;
  const selectedId = readWorkspaceProfileSelectionCookie(
    cookieHeader,
    workspaceId,
  );
  let profile = selectWorkspaceProfileForBootstrap({
    cookieHeader,
    workspaceId,
  });

  if (selectedId && profile.id !== selectedId) {
    const theme = nuxtApp.$theme as ThemePlugin | undefined;
    const bundledProfiles: unknown[] = [];
    if (theme) {
      const themeNames = [
        theme.activeTheme.value,
        ...(theme.availableThemes ?? [])
          .map((candidate) => candidate.name)
          .filter((name) => name !== theme.activeTheme.value),
      ];
      for (const themeName of themeNames) {
        try {
          const definition =
            theme.getTheme(themeName) ?? (await theme.loadTheme(themeName));
          bundledProfiles.push(...(definition?.workspaceProfiles ?? []));
          if (
            definition?.workspaceProfiles?.some(
              (candidate) => candidate.id === selectedId,
            )
          ) {
            break;
          }
        } catch (error) {
          if (import.meta.dev) {
            console.warn(
              `[workspace-profiles] Could not inspect theme "${themeName}" during SSR`,
              error,
            );
          }
        }
      }
    }
    profile = selectWorkspaceProfileForBootstrap({
      cookieHeader,
      workspaceId,
      additionalProfiles: bundledProfiles,
    });
  }

  const payload = createWorkspaceProfileHydrationPayload(
    profile,
    DEFAULT_WORKSPACE_PROFILE_INVENTORY,
    {
      maxDesktopPanes: Math.max(1, Math.floor(config.ui.maxPanes)),
      mobilePolicy: "single-pane",
    },
  );
  nuxtApp.payload.data.__or3WorkspaceProfile = payload;
  setRequestResolvedWorkspaceProfile(
    nuxtApp,
    hydrateWorkspaceProfilePayload(payload),
  );
});
