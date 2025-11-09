# Theme Page Rework – Rollback Plan

If the new `useUserThemeOverrides` system needs to be rolled back, follow these steps:

1. **Create a snapshot:**

    - Tag the current release branch before reverting (`git tag rollback-pre-theme-overrides`).
    - Push the tag to origin so CI artifacts remain accessible.

2. **Revert code changes:**

    - Revert the commits that removed the legacy `useThemeSettings` files and introduced the new overrides composable and plugins.
    - Restore deleted files from the `theme-expansion-v2` branch history (`useThemeSettings.ts`, `theme-apply.ts`, `theme-settings.client.ts`, related tests, docs).
    - Ensure `app/plugins/theme-overrides.client.ts` is removed along with new migration logic.

3. **Restore documentation:**

    - Revert `docs/UI/theme-settings.md`, `docs/theme-backgrounds.md`, and `docs/changelog.md` to the previous revision.
    - Update `docs/README.md` to point back to the legacy documentation.

4. **Rehydrate data expectations:**

    - Re-enable reading/writing of `theme:settings:v1:*` keys in localStorage.
    - Disable the new migration by removing `migrateFromLegacy()` and restoring `buildBackgroundsFromSettings()`.

5. **Verify locally:**

    - Run `bunx tsc --noEmit` and `bunx vitest run` to confirm the reverted code builds and tests pass.
    - Launch `bun run dev`, visit the dashboard Theme page, and confirm backgrounds/settings apply immediately.

6. **Deploy rollback:**

    - Ship the revert through staging, confirm no migration data loss, then deploy to production.
    - Monitor error logs and user feedback for the next 24 hours.

7. **Document the rollback:**
    - Record the rollback decision, linked issues, and next steps in the changelog and planning docs.
