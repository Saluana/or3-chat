/**
 * @module app/composables/chat/useSettingsLibraryTheme
 *
 * Theme bindings shared by the chat settings library pages (Models and
 * System prompts). Each control resolves its own `settings` identifier so a
 * theme can restyle the pages without reaching into component internals.
 */
import { computed } from 'vue';
import { useButtonOverrides } from '~/composables/useTypedThemeOverrides';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { buildThemeOverrideProps } from '~/composables/ui/themeOverrideProps';

/**
 * Identifiers themes can target. Inputs, icon actions, and the filter button
 * resolve in the `settings` context (`button.settings#settings.library-action`);
 * the filled Use/In use buttons resolve by identifier alone
 * (`button#settings.library-use`). Native chips and rows carry `v-theme`.
 */
export const SETTINGS_LIBRARY_THEME_IDS = {
    search: 'settings.library-search',
    filter: 'settings.library-filter',
    chip: 'settings.library-chip',
    row: 'settings.library-row',
    action: 'settings.library-action',
    use: 'settings.library-use',
    inUse: 'settings.library-in-use',
    headerAction: 'settings.header-action',
} as const;

export function useSettingsLibraryTheme() {
    const ids = SETTINGS_LIBRARY_THEME_IDS;
    // Untyped like the catalog search: theme input props pass straight to UInput.
    const searchOverrides = useThemeOverrides({
        component: 'input',
        context: 'settings',
        identifier: ids.search,
        isNuxtUI: true,
    });
    return {
        ids,
        searchProps: computed(() => buildThemeOverrideProps(searchOverrides.value)),
        filterProps: useButtonOverrides(
            { component: 'button', context: 'settings', identifier: ids.filter },
            { variant: 'ghost', color: 'neutral', size: 'sm', square: true }
        ),
        actionProps: useButtonOverrides(
            { component: 'button', context: 'settings', identifier: ids.action },
            { variant: 'ghost', color: 'neutral', square: true }
        ),
        // Filled buttons skip the `settings` context: themes style settings
        // buttons as flat rows (e.g. blank's `button.settings`), which would
        // erase a solid button's contrast. Identifiers still target them.
        useProps: useButtonOverrides(
            { component: 'button', identifier: ids.use },
            { variant: 'solid', color: 'primary' }
        ),
        inUseProps: useButtonOverrides(
            { component: 'button', identifier: ids.inUse },
            { variant: 'soft', color: 'neutral' }
        ),
    };
}
