import type { ThemePlugin } from "~/theme/_shared/types";
import {
  activeThemeProfileRecommendation,
  registerThemeWorkspaceProfiles,
} from "~/core/workspace-profiles/theme-packaging";

export default defineNuxtPlugin(async (nuxtApp) => {
  const theme = useNuxtApp().$theme as ThemePlugin | undefined;
  if (!theme) return;
  const registrations = new Map<
    string,
    ReturnType<typeof registerThemeWorkspaceProfiles>
  >();
  let disposed = false;
  let syncGeneration = 0;

  const registerTheme = async (themeId: string) => {
    if (disposed || registrations.has(themeId)) return;
    try {
      const definition = await theme.loadTheme(themeId);
      if (disposed || registrations.has(themeId)) return;
      if (!definition?.workspaceProfiles?.length) return;
      const registration = registerThemeWorkspaceProfiles(
        themeId,
        {
          workspaceProfiles: definition.workspaceProfiles,
          recommendedWorkspaceProfileId:
            definition.recommendedWorkspaceProfileId,
        },
        {
          publishRecommendation: false,
        },
      );
      registrations.set(themeId, registration);
    } catch (error) {
      console.error(
        `[workspace-profiles] Theme "${themeId}" profiles were rejected`,
        error,
      );
    }
  };

  const sync = async (themeId: string) => {
    const generation = ++syncGeneration;
    await registerTheme(themeId);
    for (const candidate of theme.availableThemes ?? []) {
      if (candidate.name === themeId) continue;
      await registerTheme(candidate.name);
    }
    if (disposed || generation !== syncGeneration) return;
    const activeRegistration = registrations.get(themeId);
    activeThemeProfileRecommendation.value =
      activeRegistration?.recommendedProfileId
        ? {
            themeId,
            profileId: activeRegistration.recommendedProfileId,
          }
        : null;
  };

  await sync(theme.activeTheme.value);
  const stop = watch(
    () => theme.activeTheme.value,
    (themeId) => {
      void sync(themeId);
    },
  );

  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    syncGeneration++;
    stop();
    for (const registration of [...registrations.values()].reverse()) {
      registration.dispose();
    }
    registrations.clear();
    activeThemeProfileRecommendation.value = null;
  };
  (
    nuxtApp.hook as unknown as (
      name: "app:beforeUnmount",
      callback: () => void,
    ) => void
  )("app:beforeUnmount", cleanup);
  if (import.meta.hot) {
    import.meta.hot.dispose(cleanup);
  }
});
