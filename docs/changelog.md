# Changelog

## 2025-11-08

-   Replaced legacy `useThemeSettings` system with `useUserThemeOverrides`, including background, palette, and typography handling.
-   Added client plugin `app/plugins/theme-overrides.client.ts` to hydrate overrides on boot.
-   Removed deprecated helpers (`buildBackgroundsFromSettings`, legacy theme files) and updated documentation to match the new architecture.
