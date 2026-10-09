import { GENERATED_THEME_METADATA } from '~/theme/_shared/theme-manifest.generated';
import type { ThemePlugin } from "~/theme/_shared/types";
import {
  activeThemeProfileRecommendation,
  registerThemeWorkspaceProfiles,
} from "~/core/workspace-profiles/theme-packaging";

export default defineNuxtPlugin((nuxtApp) => {
  const theme = useNuxtApp().$theme as ThemePlugin | undefined;
  if (!theme) return;
  const registrations = new Map<
    string,
    ReturnType<typeof registerThemeWorkspaceProfiles>
  >();
  let disposed = false;

  // Profiles are validated build metadata, independent of full theme loading.
  // Register all choices before the saved selection resolves on the client.
  for (const metadata of GENERATED_THEME_METADATA) {
    try {
      registrations.set(metadata.name, registerThemeWorkspaceProfiles(
        metadata.name, metadata, { publishRecommendation: false },
      ));
    } catch (error) {
      console.error('[workspace-profiles] Theme profiles were rejected', error);
    }
  }
  const syncRecommendation = (themeId: string) => {
    const recommendation = registrations.get(themeId)?.recommendedProfileId;
    activeThemeProfileRecommendation.value = recommendation
      ? { themeId, profileId: recommendation }
      : null;
  };
  const stop = watch(() => theme.activeTheme.value, syncRecommendation, { immediate: true });

  const cleanup = () => {
    if (disposed) return;
    disposed = true;
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
