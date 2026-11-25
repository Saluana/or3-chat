import { getWorkspaceGeneration } from '~/db/client';
import { APPEARANCE_SETTING_DESCRIPTIONS as descriptions } from '~/core/theme/appearance-setting-descriptions';
import { USER_FONT_OPTIONS } from '~/core/theme/font-options';
import { UI_SCALE_CHOICES } from '~/core/theme/theme-token-presets';
import type { useUserThemeOverrides } from '~/core/theme/useUserThemeOverrides';
import type { UserBackgroundLayer, UserThemeOverrides } from '~/core/theme/user-overrides-types';
import {
    BACKGROUND_AREAS,
    BACKGROUND_AREA_LABELS,
    BACKGROUND_AREA_PATTERNS,
    backgroundAreasPatch,
    chosenImageLayer,
    getBackgroundImageMeta,
    hashFromBackgroundUrl,
    listBackgroundImages,
    listThreadImageHashes,
    readBackgroundArea,
    type BackgroundArea,
} from '~/core/theme/background-image-library';
import { getImageMetasByHashes } from '~/db/files-select';
import { registerToolCard } from './tool-cards-public';
import BackgroundImageToolCard from '~/components/chat/tool-cards/BackgroundImageToolCard.vue';
import { COLOR_TOKEN_ALIASES, COLOR_TOKEN_DESCRIPTIONS, COLOR_TOKEN_REGISTRY, type RegisteredColorToken } from '~/theme/_shared/design-token-registry';
import type { JsonSchemaObject } from '~~/shared/chat/tool-schema';
import { defineTool, useToolRegistry } from './tools-public';
import type { ToolExecutionContext } from './types';
import { workspaceToolsAvailable } from './workspace-access';

const colors = Object.entries(COLOR_TOKEN_REGISTRY) as [RegisteredColorToken, string][];
const modeSchema = { type: 'string', enum: ['light', 'dark'], description: descriptions.mode };
const hexColor = { type: 'string', pattern: '^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$' };
const font = { type: 'string', enum: USER_FONT_OPTIONS.map(({ value }) => value) };
const borderWidth = { type: 'number', minimum: 0, maximum: 6 };
const radius = { type: 'number', minimum: 0, maximum: 32 };

function objectSchema(properties: Record<string, unknown>, required: string[] = []): JsonSchemaObject {
    return { type: 'object', properties, required, additionalProperties: false };
}

function describedProperties<Fields extends Record<string, Record<string, unknown>>>(
    fields: Fields,
    help: Record<keyof Fields, string>,
) {
    return Object.fromEntries(Object.entries(fields).map(([key, schema]) => [
        key, { ...schema, description: help[key as keyof Fields] },
    ]));
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
type AppearancePatch = Pick<UserThemeOverrides, 'colors' | 'typography' | 'shape' | 'chat'>;
type UpdateArgs = AppearancePatch & { mode: Mode };

const inspect = appearanceTool('get_appearance', 'Inspect appearance',
    'See your current theme, color mode, and custom settings.',
    'Read the active theme and color mode, effective color values, saved overrides, and what each appearance setting changes.',
    objectSchema({}));
const update = appearanceTool<UpdateArgs>('update_appearance', 'Change appearance',
    'Change colors, fonts, interface size, borders, corners, or message button placement.',
    `Edit the active mode’s colors, fonts, interface scale, borders, corner radii, or the panel behind assistant messages. Read get_appearance first and pass its mode. Colors use #RRGGBB or #RRGGBBAA. ${descriptions.backdropOpacity} ${descriptions.assistantMessageOpacity} When a background image makes replies hard to read, set colors.assistantMessage to a semi-opaque color that contrasts with onSurface (for example the surface color at alpha cc). Only enable chat.assistantBlur when the user asks for blur. When message buttons are hard to see over a background image, set chat.userActionsInside and/or chat.assistantActionsInside to move them inside the messages. Include onPrimary or onPrimaryContainer when adjusting their respective fills for contrast. Omitted settings are preserved.`,
    {
        ...objectSchema({
            mode: modeSchema,
            colors: {
                ...objectSchema({
                    enabled: { type: 'boolean', description: descriptions.colors.enabled },
                    ...Object.fromEntries(colors.map(([key]) => [key, { ...hexColor, description: COLOR_TOKEN_DESCRIPTIONS[key] }])),
                }),
                minProperties: 1,
            },
            typography: {
                ...objectSchema(describedProperties({
                    bodyFont: font,
                    headingFont: font,
                    baseFontPx: { type: 'number', minimum: 14, maximum: 24 },
                    uiScale: { enum: UI_SCALE_CHOICES },
                }, descriptions.typography)),
                minProperties: 1,
            },
            shape: {
                ...objectSchema(describedProperties({
                    enabled: { type: 'boolean' },
                    borderWidthSubtlePx: borderWidth,
                    borderWidthPx: borderWidth,
                    borderWidthStrongPx: borderWidth,
                    borderRadiusSmallPx: radius,
                    borderRadiusPx: radius,
                    borderRadiusLargePx: radius,
                }, descriptions.shape)),
                minProperties: 1,
            },
            chat: {
                ...objectSchema(describedProperties({
                    assistantBlur: { type: 'boolean' },
                    userActionsInside: { type: 'boolean' },
                    assistantActionsInside: { type: 'boolean' },
                }, descriptions.chat)),
                minProperties: 1,
            },
        }, ['mode']),
        minProperties: 2,
    });
type BackgroundLayout = 'fill' | 'single' | 'repeat';
type BackgroundArgs = {
    mode: Mode;
    areas: BackgroundArea[];
    image: string;
    layout?: BackgroundLayout;
    opacity?: number;
};

/** Maximum images get_appearance offers; chat images are listed first. */
const MAX_OFFERED_IMAGES = 12;
const BACKGROUND_LAYOUTS: Record<BackgroundLayout, Pick<UserBackgroundLayer, 'fit' | 'repeat'>> = {
    fill: { fit: true, repeat: 'no-repeat' },
    single: { fit: false, repeat: 'no-repeat' },
    repeat: { fit: false, repeat: 'repeat' },
};

const setBackground = appearanceTool<BackgroundArgs>('set_background_image', 'Set background image',
    'Put a photo from your files or this chat behind the workspace or sidebar.',
    `Set the background image of one or more app areas in the active mode. Read get_appearance first and pass its mode. Areas: content is the main workspace background (${BACKGROUND_AREA_LABELS.content}), overlay is a second texture layer drawn over it (${BACKGROUND_AREA_LABELS.overlay}), sidebar is the navigation sidebar. Use "content" unless the user names another area. image is a hash from get_appearance images (images marked inChat were sent in this chat, newest first, so "the photo I just sent" is the first inChat image), "theme" for the theme's default pattern, or "none" to clear the area. Photos default to layout "fill". Keep opacity low (0.15-0.35) when the user wants the background subtle so text stays readable. For a busy or high-contrast photo, offer to add a panel behind assistant messages with update_appearance colors.assistantMessage. Custom backgrounds are switched on automatically.`,
    objectSchema({
        mode: modeSchema,
        areas: {
            type: 'array',
            items: { type: 'string', enum: [...BACKGROUND_AREAS] },
            minItems: 1,
            maxItems: BACKGROUND_AREAS.length,
            uniqueItems: true,
            description: 'Which areas to change. content = main workspace, overlay = second workspace layer, sidebar = navigation sidebar.',
        },
        image: { type: 'string', minLength: 1, maxLength: 128, description: 'An image hash from get_appearance images, "theme", or "none".' },
        layout: { type: 'string', enum: Object.keys(BACKGROUND_LAYOUTS), description: 'fill covers the whole area, single shows the image once, repeat tiles it as a pattern.' },
        opacity: { type: 'number', minimum: 0, maximum: 1, description: 'Image opacity from 0 to 1. Omit to keep the current value (at least 0.35 for a new photo).' },
    }, ['mode', 'areas', 'image']));
const setMode = appearanceTool<{ mode: Mode }>('set_appearance_mode', 'Switch color mode',
    'Switch between light and dark mode.',
    'Switch the app between light and dark mode. Each mode keeps its own appearance overrides.',
    objectSchema({ mode: modeSchema }, ['mode']));

async function withAppearanceAuthority(
    context: ToolExecutionContext,
    run: (assertCurrent: () => void) => string | Promise<string>,
) {
    const generation = getWorkspaceGeneration();
    const assertCurrent = () => {
        context.abortSignal.throwIfAborted();
        if (getWorkspaceGeneration() !== generation || !workspaceToolsAvailable(context)) {
            throw new Error('The originating workspace is no longer active.');
        }
    };
    await context.assertToolAuthorized?.();
    assertCurrent();
    return run(assertCurrent);
}

function describeArea(layer: Partial<UserBackgroundLayer> | undefined, area: BackgroundArea) {
    const url = layer?.url ?? null;
    const hash = hashFromBackgroundUrl(url);
    return {
        label: BACKGROUND_AREA_LABELS[area],
        image: hash ?? (url === BACKGROUND_AREA_PATTERNS[area].src ? 'theme' : url ? 'other' : 'none'),
        layout: layer?.fit ? 'fill' : layer?.repeat === 'no-repeat' ? 'single' : 'repeat',
        opacity: layer?.opacity ?? 0,
    };
}

/** Chat attachments first (newest first), then recent workspace images. */
async function offeredImages(threadId: string | null) {
    const chatHashes = threadId ? await listThreadImageHashes(threadId) : [];
    const chat = (await getImageMetasByHashes(chatHashes.slice(0, MAX_OFFERED_IMAGES)))
        .filter((meta) => meta.deleted !== true);
    const seen = new Set(chat.map((meta) => meta.hash));
    const recent = (await listBackgroundImages({ limit: MAX_OFFERED_IMAGES })).items
        .filter((meta) => !seen.has(meta.hash));
    return [
        ...chat.map((meta) => ({ hash: meta.hash, name: meta.name, inChat: true })),
        ...recent.map((meta) => ({ hash: meta.hash, name: meta.name, inChat: false })),
    ].slice(0, MAX_OFFERED_IMAGES);
}

export function registerAppearanceTools(theme: ReturnType<typeof useUserThemeOverrides>) {
    const registry = useToolRegistry();
    const options = { runtime: 'client', available: workspaceToolsAvailable } as const;
    const registrations: Array<{ dispose(): boolean }> = [];
    const dispose = () => registrations.forEach((registration) => registration.dispose());

    try {
        registrations.push(registry.registerTool(inspect, (_, context) => withAppearanceAuthority(context, async (assertCurrent) => {
            const images = await offeredImages(context.threadId);
            assertCurrent();
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
            const { colors: savedColors, typography, shape, chat } = theme.overrides.value;
            return JSON.stringify({
                theme: root.dataset.theme,
                mode: theme.activeMode.value,
                effectiveColors,
                colorTokenDescriptions: COLOR_TOKEN_DESCRIPTIONS,
                settingDescriptions: descriptions,
                overrides: { colors: savedColors, typography, shape, chat },
                backgrounds: {
                    enabled: theme.overrides.value.backgrounds?.enabled ?? false,
                    areas: Object.fromEntries(BACKGROUND_AREAS.map((area) => [
                        area, describeArea(readBackgroundArea(theme.overrides.value, area), area),
                    ])),
                },
                images,
            });
        }), options));
        registrations.push(registry.registerTool(update, ({ mode, colors, typography, shape, chat }, context) => withAppearanceAuthority(context, () => {
            if (theme.activeMode.value !== mode) {
                throw new Error('The active color mode changed. Read get_appearance before trying again.');
            }
            const patch: AppearancePatch = {};
            if (colors) patch.colors = { enabled: true, ...colors };
            if (typography) patch.typography = typography;
            if (shape) patch.shape = { enabled: true, ...shape };
            if (chat) patch.chat = chat;
            theme.set(patch);
            return JSON.stringify({ mode, updated: patch });
        }), options));
        registrations.push(registry.registerTool(setBackground, (args, context) => withAppearanceAuthority(context, async (assertCurrent) => {
            const { mode, areas, image } = args;
            const assertMode = () => {
                if (theme.activeMode.value !== mode) {
                    throw new Error('The active color mode changed. Read get_appearance before trying again.');
                }
            };
            assertMode();
            const meta = image === 'theme' || image === 'none' ? null : await getBackgroundImageMeta(image);
            if (image !== 'theme' && image !== 'none' && !meta) {
                throw new Error('No image with that hash is in this workspace. Use a hash from get_appearance images.');
            }
            assertCurrent();
            assertMode();
            const inChat = meta && context.threadId
                ? (await listThreadImageHashes(context.threadId)).includes(meta.hash)
                : false;
            assertCurrent();
            assertMode();
            const layoutKey: BackgroundLayout = args.layout ?? (image === 'theme' ? 'repeat' : 'fill');
            const layers: Partial<Record<BackgroundArea, Partial<UserBackgroundLayer>>> = {};
            const applied = areas.map((area) => {
                const current = readBackgroundArea(theme.overrides.value, area);
                let layer: Partial<UserBackgroundLayer>;
                if (meta) layer = { ...chosenImageLayer(meta.hash, current?.opacity), ...BACKGROUND_LAYOUTS[layoutKey] };
                else if (image === 'theme') {
                    const pattern = BACKGROUND_AREA_PATTERNS[area];
                    layer = { url: pattern.src, opacity: pattern.opacity, ...BACKGROUND_LAYOUTS[layoutKey] };
                } else layer = { url: null, opacity: 0 };
                if (args.opacity !== undefined && image !== 'none') layer.opacity = args.opacity;
                layers[area] = layer;
                return { area, label: BACKGROUND_AREA_LABELS[area], opacity: layer.opacity ?? 0 };
            });
            // One write so every area changes together, and the change is visible.
            theme.set(backgroundAreasPatch(layers, { enabled: true }));
            return JSON.stringify({
                mode,
                areas: applied,
                image: meta ? { kind: 'file', hash: meta.hash, name: meta.name, inChat } : { kind: image },
                layout: image === 'none' ? null : layoutKey,
            });
        }), options));
        registrations.push(registerToolCard({
            tool: setBackground.function.name,
            card: { mount() {}, component: BackgroundImageToolCard },
            label: 'Background image',
        }));
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
