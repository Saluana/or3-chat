import { z } from 'zod';
import type {
    Or3Config,
    Or3ConfigOptions,
    ResolvedOr3Config,
} from '../types/or3-config';

// ─────────────────────────────────────────────────────────────────────────────
// Default Configuration
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_OR3_CONFIG: ResolvedOr3Config = {
    site: {
        name: 'OR3',
        description: '',
        logoUrl: '',
        faviconUrl: '',
        defaultTheme: 'blank',
    },
    features: {
        workflows: {
            enabled: true,
            editor: true,
            slashCommands: true,
            execution: true,
        },
        documents: {
            enabled: true,
        },
        backup: {
            enabled: true,
        },
        mentions: {
            enabled: true,
            documents: true,
            conversations: true,
        },
        dashboard: {
            enabled: true,
        },
    },
    limits: {
        maxFileSizeBytes: 20 * 1024 * 1024, // 20MB
        maxCloudFileSizeBytes: 100 * 1024 * 1024, // 100MB
        maxFilesPerMessage: 10,
        localStorageQuotaMB: null,
    },
    ui: {
        defaultPaneCount: 1,
        maxPanes: 4,
        sidebarCollapsedByDefault: false,
    },
    extensions: {},
    legal: {
        termsUrl: '',
        privacyUrl: '',
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Zod Schema
// ─────────────────────────────────────────────────────────────────────────────

const or3ConfigSchema = z
    .object({
        site: z
            .object({
                name: z.string().min(1).optional(),
                description: z.string().optional(),
                logoUrl: z.string().optional(),
                faviconUrl: z.string().optional(),
                defaultTheme: z.string().optional(),
            })
            .optional()
            .transform((val) => ({
                name: val?.name ?? DEFAULT_OR3_CONFIG.site.name,
                description: val?.description ?? DEFAULT_OR3_CONFIG.site.description,
                logoUrl: val?.logoUrl ?? DEFAULT_OR3_CONFIG.site.logoUrl,
                faviconUrl: val?.faviconUrl ?? DEFAULT_OR3_CONFIG.site.faviconUrl,
                defaultTheme: val?.defaultTheme ?? DEFAULT_OR3_CONFIG.site.defaultTheme,
            })),
        features: z
            .object({
                workflows: z
                    .object({
                        enabled: z.boolean().optional(),
                        editor: z.boolean().optional(),
                        slashCommands: z.boolean().optional(),
                        execution: z.boolean().optional(),
                    })
                    .optional()
                    .transform((val) => ({
                        enabled: val?.enabled ?? DEFAULT_OR3_CONFIG.features.workflows.enabled,
                        editor: val?.editor ?? DEFAULT_OR3_CONFIG.features.workflows.editor,
                        slashCommands: val?.slashCommands ?? DEFAULT_OR3_CONFIG.features.workflows.slashCommands,
                        execution: val?.execution ?? DEFAULT_OR3_CONFIG.features.workflows.execution,
                    })),
                documents: z
                    .object({
                        enabled: z.boolean().optional(),
                    })
                    .optional()
                    .transform((val) => ({
                        enabled: val?.enabled ?? DEFAULT_OR3_CONFIG.features.documents.enabled,
                    })),
                backup: z
                    .object({
                        enabled: z.boolean().optional(),
                    })
                    .optional()
                    .transform((val) => ({
                        enabled: val?.enabled ?? DEFAULT_OR3_CONFIG.features.backup.enabled,
                    })),
                mentions: z
                    .object({
                        enabled: z.boolean().optional(),
                        documents: z.boolean().optional(),
                        conversations: z.boolean().optional(),
                    })
                    .optional()
                    .transform((val) => ({
                        enabled: val?.enabled ?? DEFAULT_OR3_CONFIG.features.mentions.enabled,
                        documents: val?.documents ?? DEFAULT_OR3_CONFIG.features.mentions.documents,
                        conversations: val?.conversations ?? DEFAULT_OR3_CONFIG.features.mentions.conversations,
                    })),
                dashboard: z
                    .object({
                        enabled: z.boolean().optional(),
                    })
                    .optional()
                    .transform((val) => ({
                        enabled: val?.enabled ?? DEFAULT_OR3_CONFIG.features.dashboard.enabled,
                    })),
            })
            .optional()
            .transform((val) => ({
                workflows: val?.workflows ?? DEFAULT_OR3_CONFIG.features.workflows,
                documents: val?.documents ?? DEFAULT_OR3_CONFIG.features.documents,
                backup: val?.backup ?? DEFAULT_OR3_CONFIG.features.backup,
                mentions: val?.mentions ?? DEFAULT_OR3_CONFIG.features.mentions,
                dashboard: val?.dashboard ?? DEFAULT_OR3_CONFIG.features.dashboard,
            })),
        limits: z
            .object({
                maxFileSizeBytes: z.number().int().positive().optional(),
                maxCloudFileSizeBytes: z.number().int().positive().optional(),
                maxFilesPerMessage: z.number().int().min(1).optional(),
                localStorageQuotaMB: z.number().int().positive().nullable().optional(),
            })
            .optional()
            .transform((val) => ({
                maxFileSizeBytes: val?.maxFileSizeBytes ?? DEFAULT_OR3_CONFIG.limits.maxFileSizeBytes,
                maxCloudFileSizeBytes: val?.maxCloudFileSizeBytes ?? DEFAULT_OR3_CONFIG.limits.maxCloudFileSizeBytes,
                maxFilesPerMessage: val?.maxFilesPerMessage ?? DEFAULT_OR3_CONFIG.limits.maxFilesPerMessage,
                localStorageQuotaMB: val?.localStorageQuotaMB ?? DEFAULT_OR3_CONFIG.limits.localStorageQuotaMB,
            })),
        ui: z
            .object({
                defaultPaneCount: z.number().int().min(1).max(4).optional(),
                maxPanes: z.number().int().min(1).max(8).optional(),
                sidebarCollapsedByDefault: z.boolean().optional(),
            })
            .optional()
            .transform((val) => ({
                defaultPaneCount: val?.defaultPaneCount ?? DEFAULT_OR3_CONFIG.ui.defaultPaneCount,
                maxPanes: val?.maxPanes ?? DEFAULT_OR3_CONFIG.ui.maxPanes,
                sidebarCollapsedByDefault: val?.sidebarCollapsedByDefault ?? DEFAULT_OR3_CONFIG.ui.sidebarCollapsedByDefault,
            })),
        extensions: z.record(z.string(), z.unknown()).optional().default(() => ({})),
        legal: z
            .object({
                termsUrl: z.string().url().or(z.literal('')).optional(),
                privacyUrl: z.string().url().or(z.literal('')).optional(),
            })
            .optional()
            .transform((val) => ({
                termsUrl: val?.termsUrl ?? DEFAULT_OR3_CONFIG.legal.termsUrl,
                privacyUrl: val?.privacyUrl ?? DEFAULT_OR3_CONFIG.legal.privacyUrl,
            })),
    })
    .passthrough();

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const formatConfigErrors = (errors: string[]): string => {
    const heading = '[or3-config] Configuration validation failed:';
    return `${heading}\n${errors.map((err) => `- ${err}`).join('\n')}`;
};

function validateConfig(config: unknown): ResolvedOr3Config {
    const parsed = or3ConfigSchema.safeParse(config);
    if (!parsed.success) {
        const errors = parsed.error.issues.map((issue) =>
            issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message
        );
        throw new Error(formatConfigErrors(errors));
    }
    return parsed.data as ResolvedOr3Config;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Define and validate an OR3 configuration object.
 *
 * @param config - Partial configuration object with user overrides
 * @param options - Validation options (strict mode, etc.)
 * @returns Fully resolved configuration with defaults applied
 *
 * @example
 * ```ts
 * export const or3Config = defineOr3Config({
 *     site: { name: 'My Chat App' },
 *     features: { workflows: { editor: false } },
 * });
 * ```
 */
export function defineOr3Config(
    config: Partial<Or3Config> = {},
    _options: Or3ConfigOptions = {}
): ResolvedOr3Config {
    return validateConfig(config);
}
