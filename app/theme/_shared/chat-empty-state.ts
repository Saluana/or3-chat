import { z } from 'zod';

export const EMPTY_CHAT_ACTION_IDS = [
    'start-chat',
    'start-project',
    'create-document',
] as const;
export type EmptyChatActionId = (typeof EMPTY_CHAT_ACTION_IDS)[number];
const copy = z.union([z.string(), z.literal(false)]).optional();
const asset = z
    .string()
    .min(1)
    .refine(
        (value) =>
            /^(?:\/(?!\/)|https?:\/\/|internal-file:\/\/)/.test(value) &&
            !/[\x00-\x20<>"\\]/.test(value),
        'Use a local public path, HTTP(S) URL, or internal-file:// token',
    );
const css = z
    .string()
    .min(1)
    .refine(
        (value) => !/[;{}<>]|url\s*\(/i.test(value),
        'Use a CSS value without declarations or URLs',
    );
const image = z
    .object({
        src: asset,
        width: z.number().finite().positive(),
        height: z.number().finite().positive(),
        alt: z.string().optional(),
    })
    .strict();
const background = z
    .object({
        image: asset.nullable().optional(),
        color: css.optional(),
        opacity: z.number().min(0).max(1).optional(),
        fit: z.enum(['cover', 'contain']).optional(),
        repeat: z
            .enum(['repeat', 'no-repeat', 'repeat-x', 'repeat-y'])
            .optional(),
        size: css.optional(),
    })
    .strict();
const action = z
    .object({
        id: z.enum(EMPTY_CHAT_ACTION_IDS),
        label: z.string().min(1).optional(),
        description: copy,
        icon: z.string().min(1).optional(),
    })
    .strict();
const appearance = z
    .object({
        heading: copy,
        description: copy,
        hero: z.union([image, z.literal(false)]).optional(),
        accent: z.union([image, z.literal(false)]).optional(),
        background: z.union([background, z.literal(false)]).optional(),
        actions: z
            .array(action)
            .refine(
                (items) =>
                    new Set(items.map((item) => item.id)).size === items.length,
                'Action IDs must be unique',
            )
            .optional(),
        layout: z.enum(['cards', 'compact', 'stacked']).optional(),
    })
    .strict();
export const ThemeChatEmptyStateSchema = z
    .union([
        z.literal(false),
        appearance.extend({
            dark: z.union([z.literal(false), appearance]).optional(),
        }),
    ])
    .optional();
export type ThemeEmptyChatAppearance = z.infer<typeof appearance>;
export type ThemeChatEmptyState = z.infer<typeof ThemeChatEmptyStateSchema>;
export type EmptyChatImage = z.infer<typeof image>;
export type ThemeEmptyChatAction = z.infer<typeof action>;
export interface EmptyChatAction extends Required<
    Omit<ThemeEmptyChatAction, 'description'>
> {
    description: string | false;
}
export interface ResolvedChatEmptyState extends Omit<
    ThemeEmptyChatAppearance,
    'actions'
> {
    actions: EmptyChatAction[];
}

const defaults: EmptyChatAction[] = [
    {
        id: 'start-chat',
        label: 'Start a chat',
        description: 'Ask anything, explore ideas, or get help.',
        icon: 'sidebar.category.chats',
    },
    {
        id: 'start-project',
        label: 'Start a project',
        description: 'Keep your chats, docs, and tools organized.',
        icon: 'sidebar.category.projects',
    },
    {
        id: 'create-document',
        label: 'Create a document',
        description: 'Write, plan, and collaborate with AI.',
        icon: 'sidebar.category.documents',
    },
];

/** Shared normalization for trusted source and installed declarative themes. */
export function resolveChatEmptyState(
    value: unknown,
    mode: string,
): ResolvedChatEmptyState | null {
    const parsed = ThemeChatEmptyStateSchema.safeParse(value);
    if (!parsed.success || !parsed.data) return null;
    const { dark, ...base } = parsed.data;
    if (mode === 'dark' && dark === false) return null;
    const resolved = { ...base, ...(mode === 'dark' && dark ? dark : {}) };
    return {
        ...resolved,
        layout: resolved.layout ?? 'cards',
        actions: (resolved.actions ?? defaults).map((item) => ({
            ...defaults.find((entry) => entry.id === item.id)!,
            ...item,
        })),
    };
}
