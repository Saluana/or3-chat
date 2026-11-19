import { z } from 'zod';
import type { Or3DB } from '~/db/client';
import { setKvByName, tombstoneKvByName, type StorageMutationGuard } from '~/db/kv';
import { COLOR_TOKEN_REGISTRY, type RegisteredColorToken } from '~/theme/_shared/design-token-registry';
import { parseHash } from '~/utils/hash';
import { createRuntimeUuid } from '~~/shared/runtime-id';
import { USER_FONT_OPTIONS } from './font-options';
import type { UserThemeOverrides } from './user-overrides-types';

const PREFIX = 'theme-preset:';
export const SAVED_THEME_NAME_LIMIT = 80;

const color = z.string().max(160).refine(value =>
    !/[;{}]/.test(value) && !/\b(?:url|var)\s*\(/i.test(value)
    && (typeof CSS === 'undefined' || CSS.supports('color', value))
);
const toggle = { enabled: z.boolean().optional() };
const filePrefix = 'internal-file://';
const layer = z.object({
    // Keep built-in assets and workspace file tokens; never persist blob URLs.
    url: z.string().max(512).refine(url => url.startsWith(filePrefix)
        ? parseHash(url.slice(filePrefix.length))?.full === url.slice(filePrefix.length)
        : /^\/(?!\/)[\w./-]+$/.test(url)
    ).nullable(),
    opacity: z.number().min(0).max(1),
    sizePx: z.number().positive(),
    fit: z.boolean(),
    repeat: z.enum(['repeat', 'no-repeat']),
    color: z.union([color, z.literal('')]),
}).partial();
const font = z.enum(USER_FONT_OPTIONS.map(option => option.value));
const width = z.number().min(0).max(6);
const radius = z.number().min(0).max(32);
const optionalColor = color.optional();
const colorFields = Object.fromEntries(
    Object.keys(COLOR_TOKEN_REGISTRY).map(key => [key, optionalColor]),
) as Record<RegisteredColorToken, typeof optionalColor>;
const overrides = z.object({
    colors: z.object({ ...colorFields, ...toggle }),
    backgrounds: z.object({
        content: z.object({ base: layer.optional(), overlay: layer.optional() }).optional(),
        sidebar: layer.optional(),
        headerGradient: z.object(toggle).optional(),
        bottomNavGradient: z.object(toggle).optional(),
        ...toggle,
    }),
    typography: z.object({
        baseFontPx: z.number().min(14).max(24),
        bodyFont: font,
        headingFont: font,
        useSystemFont: z.boolean(),
        uiScale: z.literal(['theme', 80, 90, 100, 110, 120]),
    }).partial(),
    shape: z.object({
        enabled: z.boolean(),
        borderWidthSubtlePx: width,
        borderWidthPx: width,
        borderWidthStrongPx: width,
        borderRadiusSmallPx: radius,
        borderRadiusPx: radius,
        borderRadiusLargePx: radius,
    }).partial(),
    density: z.object({ ...toggle, preset: z.enum(['theme', 'compact', 'comfortable', 'spacious']).optional() }),
    elevation: z.object({ ...toggle, preset: z.enum(['theme', 'flat', 'subtle', 'expressive']).optional() }),
    ui: z.object({ reducePatternsInHighContrast: z.boolean().optional() }),
}).partial() satisfies z.ZodType<UserThemeOverrides>;

const savedTheme = z.object({
    version: z.literal(1),
    name: z.string().trim().min(1).max(SAVED_THEME_NAME_LIMIT),
    baseTheme: z.string().min(1).max(100),
    light: overrides,
    dark: overrides,
});

export type SavedTheme = z.output<typeof savedTheme> & { id: string; revision: number };

export async function listSavedThemes(db: Or3DB): Promise<SavedTheme[]> {
    const rows = await db.kv.where('name').startsWith(PREFIX).toArray();
    return rows.flatMap((row) => {
        if (row.deleted || !row.value) return [];
        try {
            const preset = savedTheme.safeParse(JSON.parse(row.value));
            return preset.success ? [{ ...preset.data, id: row.name, revision: row.clock }] : [];
        } catch {
            return [];
        }
    }).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

type SavedThemeInput = { name: string; baseTheme: string; light: UserThemeOverrides; dark: UserThemeOverrides };

/** Create a preset, or replace the preset `id` in place. */
export async function saveThemePreset(
    db: Or3DB,
    value: SavedThemeInput,
    guard: StorageMutationGuard & { readonly ifClock?: number | null },
    id: string = PREFIX + createRuntimeUuid(),
): Promise<void> {
    if (!id.startsWith(PREFIX)) throw new Error('Invalid saved theme id');
    const preset = savedTheme.parse({ ...value, version: 1 });
    await setKvByName(id, JSON.stringify(preset), db, guard);
}

export async function deleteSavedTheme(db: Or3DB, preset: SavedTheme, guard: StorageMutationGuard): Promise<void> {
    if (!preset.id.startsWith(PREFIX)) throw new Error('Invalid saved theme id');
    await tombstoneKvByName(preset.id, db, { ...guard, ifClock: preset.revision });
}

/** True when the current base theme and both modes are exactly what the preset would restore. */
export function matchesSavedTheme(preset: SavedTheme, current: SavedThemeInput): boolean {
    if (preset.baseTheme !== current.baseTheme) return false;
    const parsed = savedTheme.safeParse({ ...current, name: preset.name, version: 1 });
    const { id: _id, revision: _revision, ...stored } = preset;
    return parsed.success && JSON.stringify(parsed.data) === JSON.stringify(stored);
}
