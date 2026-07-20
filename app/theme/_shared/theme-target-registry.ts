/** Canonical aliases and contracts for component override targets. */
export interface ThemeTargetDefinition {
    target: string;
    vueNames: readonly string[];
    kind: 'nuxt-ui' | 'dom';
    allowedProps: readonly string[];
}

const NUXT_UI_TARGET_ALIASES = [
    ['card', ['UCard']], ['badge', ['UBadge']], ['alert', ['UAlert']],
    ['avatar', ['UAvatar']], ['table', ['UTable']], ['form', ['UForm']],
    ['form-group', ['UFormGroup']], ['tabs', ['UTabs']],
    ['accordion', ['UAccordion']], ['dropdown', ['UDropdown']],
    ['popover', ['UPopover']], ['tooltip', ['UTooltip']],
    ['notification', ['UNotification']], ['command-palette', ['UCommandPalette']],
    ['slideover', ['USlideover']], ['divider', ['UDivider']],
    ['skeleton', ['USkeleton']], ['kbd', ['UKbd']], ['range', ['URange']],
    ['toggle', ['UToggle']], ['checkbox', ['UCheckbox']],
    ['radio', ['URadio']], ['icon', ['UIcon']],
] as const;

export const THEME_TARGET_REGISTRY: readonly ThemeTargetDefinition[] = [
    {
        target: 'button',
        vueNames: ['UButton'],
        kind: 'nuxt-ui',
        allowedProps: ['variant', 'color', 'size', 'disabled', 'loading', 'icon', 'ui', 'class', 'style'],
    },
    {
        target: 'input',
        vueNames: ['UInput', 'UTextarea'],
        kind: 'nuxt-ui',
        allowedProps: ['variant', 'color', 'size', 'disabled', 'loading', 'ui', 'class', 'style'],
    },
    {
        target: 'modal',
        vueNames: ['UModal'],
        kind: 'nuxt-ui',
        allowedProps: ['ui', 'class', 'style'],
    },
    {
        target: 'selectmenu',
        vueNames: ['USelect', 'USelectMenu'],
        kind: 'nuxt-ui',
        allowedProps: ['variant', 'color', 'size', 'disabled', 'ui', 'class', 'style'],
    },
    ...NUXT_UI_TARGET_ALIASES.map(([target, vueNames]) => ({
        target,
        vueNames,
        kind: 'nuxt-ui' as const,
        allowedProps: ['variant', 'color', 'size', 'disabled', 'loading', 'icon', 'ui', 'class', 'style'],
    })),
] as const;

const byVueName = new Map(
    THEME_TARGET_REGISTRY.flatMap((definition) =>
        definition.vueNames.map((name) => [name.toLowerCase(), definition] as const)
    )
);
const byTarget = new Map(
    THEME_TARGET_REGISTRY.map((definition) => [definition.target, definition] as const)
);

export function findThemeTarget(vueName: string): ThemeTargetDefinition | null {
    const normalized = vueName.toLowerCase();
    return byVueName.get(normalized) ?? byTarget.get(normalized) ?? null;
}
