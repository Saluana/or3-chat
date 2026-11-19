import { getWorkspaceGeneration } from '~/db/client';
import { USER_FONT_OPTIONS } from '~/core/theme/font-options';
import type { useUserThemeOverrides } from '~/core/theme/useUserThemeOverrides';
import type { UserThemeOverrides } from '~/core/theme/user-overrides-types';
import { COLOR_TOKEN_ALIASES, COLOR_TOKEN_REGISTRY, type RegisteredColorToken } from '~/theme/_shared/design-token-registry';
import type { JsonSchemaObject } from '~~/shared/chat/tool-schema';
import { defineTool, useToolRegistry } from './tools-public';
import type { ToolExecutionContext } from './types';
import { workspaceToolsAvailable } from './workspace-access';

const colors = Object.entries(COLOR_TOKEN_REGISTRY) as [RegisteredColorToken, string][];
const modeSchema = { type: 'string', enum: ['light', 'dark'] };
const hexColor = { type: 'string', pattern: '^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$' };
const font = { type: 'string', enum: USER_FONT_OPTIONS.map(({ value }) => value) };
const borderWidth = { type: 'number', minimum: 0, maximum: 6 };
const radius = { type: 'number', minimum: 0, maximum: 32 };

function objectSchema(properties: Record<string, unknown>, required: string[] = []): JsonSchemaObject {
    return { type: 'object', properties, required, additionalProperties: false };
}

function appearanceTool<Args extends Record<string, unknown>>(
    name: string,
    label: string,
    descriptionHint: string,
    description: string,
    parameters: JsonSchemaObject,
) {
    return defineTool<Args>({
        type: 'function',
        function: { name, description, parameters },
        ui: { label, category: 'Appearance', descriptionHint },
    });
}

type Mode = 'light' | 'dark';
type AppearancePatch = Pick<UserThemeOverrides, 'colors' | 'typography' | 'shape'>;
type UpdateArgs = AppearancePatch & { mode: Mode };

const inspect = appearanceTool('get_appearance', 'Inspect appearance',
    'See your current theme, color mode, and custom settings.',
    'Read the active app theme, light or dark mode, effective color tokens, and saved appearance overrides for that mode.',
    objectSchema({}));
const update = appearanceTool<UpdateArgs>('update_appearance', 'Change appearance',
    'Change colors, fonts, interface size, borders, or corners.',
    'Edit the active mode’s colors, fonts, interface scale, borders, or corner radii. Read get_appearance first and pass its mode. Colors use #RRGGBB or #RRGGBBAA (including dialog backdrop opacity). Include onPrimary or onPrimaryContainer when adjusting their respective fills for contrast. Omitted settings are preserved.',
    {
        ...objectSchema({
            mode: modeSchema,
            colors: {
                ...objectSchema({
                    enabled: { type: 'boolean', description: 'Enable or temporarily disable custom colors.' },
                    ...Object.fromEntries(colors.map(([key]) => [key, hexColor])),
                }),
                minProperties: 1,
            },
            typography: {
                ...objectSchema({
                    bodyFont: font,
                    headingFont: font,
                    baseFontPx: { type: 'number', minimum: 14, maximum: 24 },
                    uiScale: { enum: ['theme', 80, 90, 100, 110, 120] },
                }),
                minProperties: 1,
            },
            shape: {
                ...objectSchema({
                    enabled: { type: 'boolean', description: 'Enable or temporarily disable custom borders and radii.' },
                    borderWidthSubtlePx: borderWidth,
                    borderWidthPx: borderWidth,
                    borderWidthStrongPx: borderWidth,
                    borderRadiusSmallPx: radius,
                    borderRadiusPx: radius,
                    borderRadiusLargePx: radius,
                }),
                minProperties: 1,
            },
        }, ['mode']),
        minProperties: 2,
    });
const setMode = appearanceTool<{ mode: Mode }>('set_appearance_mode', 'Switch color mode',
    'Switch between light and dark mode.',
    'Switch the app between light and dark mode. Each mode keeps its own appearance overrides.',
    objectSchema({ mode: modeSchema }, ['mode']));

async function withAppearanceAuthority(context: ToolExecutionContext, run: () => string) {
    const generation = getWorkspaceGeneration();
    await context.assertToolAuthorized?.();
    context.abortSignal.throwIfAborted();
    if (getWorkspaceGeneration() !== generation || !workspaceToolsAvailable(context)) {
        throw new Error('The originating workspace is no longer active.');
    }
    return run();
}

export function registerAppearanceTools(theme: ReturnType<typeof useUserThemeOverrides>) {
    const registry = useToolRegistry();
    const options = { runtime: 'client', available: workspaceToolsAvailable } as const;
    const registrations: Array<{ dispose(): boolean }> = [];
    const dispose = () => registrations.forEach((registration) => registration.dispose());

    try {
        registrations.push(registry.registerTool(inspect, (_, context) => withAppearanceAuthority(context, () => {
            const root = document.documentElement;
            const css = getComputedStyle(root);
            const effectiveColors: Partial<Record<RegisteredColorToken, string>> = {};
            for (const [key, variable] of colors) {
                const candidates = [variable, ...(COLOR_TOKEN_ALIASES[key] ?? [])];
                if (key === 'menuSurface') candidates.push(COLOR_TOKEN_REGISTRY.surface);
                const value = candidates.map((candidate) => css.getPropertyValue(candidate).trim())
                    .find((candidate) => candidate && CSS.supports('color', candidate));
                if (value) effectiveColors[key] = value;
            }
            const { colors: savedColors, typography, shape } = theme.overrides.value;
            return JSON.stringify({
                theme: root.dataset.theme,
                mode: theme.activeMode.value,
                effectiveColors,
                overrides: { colors: savedColors, typography, shape },
            });
        }), options));
        registrations.push(registry.registerTool(update, ({ mode, colors, typography, shape }, context) => withAppearanceAuthority(context, () => {
            if (theme.activeMode.value !== mode) {
                throw new Error('The active color mode changed. Read get_appearance before trying again.');
            }
            const patch: AppearancePatch = {};
            if (colors) patch.colors = { enabled: true, ...colors };
            if (typography) patch.typography = typography;
            if (shape) patch.shape = { enabled: true, ...shape };
            theme.set(patch);
            return JSON.stringify({ mode, updated: patch });
        }), options));
        registrations.push(registry.registerTool(setMode, ({ mode }, context) => withAppearanceAuthority(context, () => {
            theme.switchMode(mode);
            return JSON.stringify({ mode: theme.activeMode.value });
        }), options));
    } catch (error) {
        dispose();
        throw error;
    }
    return dispose;
}
