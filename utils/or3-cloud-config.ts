import { z } from 'zod';
import type {
    Or3CloudConfig,
    Or3CloudConfigOptions,
} from '../types/or3-cloud-config';
import {
    AUTH_PROVIDER_ID_LIST,
    BACKGROUND_PROVIDER_ID_LIST,
    CLERK_PROVIDER_ID,
    CONVEX_PROVIDER_ID,
    DEFAULT_AUTH_PROVIDER_ID,
    DEFAULT_BACKGROUND_PROVIDER_ID,
    DEFAULT_LIMITS_PROVIDER_ID,
    DEFAULT_STORAGE_PROVIDER_ID,
    DEFAULT_SYNC_PROVIDER_ID,
    LIMITS_PROVIDER_ID_LIST,
    STORAGE_PROVIDER_ID_LIST,
    SYNC_PROVIDER_ID_LIST,
} from '../shared/cloud/provider-ids';

const DEFAULT_OR3_CLOUD_CONFIG: Or3CloudConfig = {
    auth: {
        enabled: false,
        provider: DEFAULT_AUTH_PROVIDER_ID,
        clerk: {
            publishableKey: undefined,
            secretKey: undefined,
        },
    },
    sync: {
        enabled: false,
        provider: DEFAULT_SYNC_PROVIDER_ID,
        convex: {
            url: undefined,
        },
    },
    storage: {
        enabled: false,
        provider: DEFAULT_STORAGE_PROVIDER_ID,
    },
    services: {
        llm: {
            openRouter: {
                instanceApiKey: undefined,
                allowUserOverride: true,
            },
        },
    },
    limits: {
        enabled: true,
        requestsPerMinute: 20,
        maxConversations: 0,
        maxMessagesPerDay: 0,
        storageProvider: DEFAULT_LIMITS_PROVIDER_ID,
    },
    security: {
        allowedOrigins: [],
        forceHttps: process.env.NODE_ENV === 'production',
    },
    admin: {
        basePath: '/admin',
        allowedHosts: [],
        allowRestart: false,
        allowRebuild: false,
        rebuildCommand: 'bun run build',
        extensionMaxZipBytes: 25 * 1024 * 1024,
        extensionMaxFiles: 2000,
        extensionMaxTotalBytes: 200 * 1024 * 1024,
        extensionAllowedExtensions: [
            '.js',
            '.mjs',
            '.cjs',
            '.ts',
            '.tsx',
            '.vue',
            '.json',
            '.css',
            '.scss',
            '.sass',
            '.less',
            '.md',
            '.txt',
            '.svg',
            '.png',
            '.jpg',
            '.jpeg',
            '.gif',
            '.webp',
            '.ico',
            '.ttf',
            '.otf',
            '.woff',
            '.woff2',
            '.map',
        ],
    },
    backgroundStreaming: {
        enabled: false,
        storageProvider: DEFAULT_BACKGROUND_PROVIDER_ID,
        maxConcurrentJobs: 20,
        jobTimeoutSeconds: 300,
    },
};

const cloudConfigSchema = z
    .object({
        auth: z.object({
            enabled: z.boolean(),
            provider: z.enum(AUTH_PROVIDER_ID_LIST),
            clerk: z
                .object({
                    publishableKey: z.string().optional(),
                    secretKey: z.string().optional(),
                })
                .optional(),
        }),
        sync: z.object({
            enabled: z.boolean(),
            provider: z.enum(SYNC_PROVIDER_ID_LIST),
            convex: z
                .object({
                    url: z.string().optional(),
                })
                .optional(),
        }),
        storage: z.object({
            enabled: z.boolean(),
            provider: z.enum(STORAGE_PROVIDER_ID_LIST),
        }),
        services: z
            .object({
                llm: z
                    .object({
                        openRouter: z
                            .object({
                                instanceApiKey: z.string().optional(),
                                allowUserOverride: z.boolean().optional(),
                            })
                            .optional(),
                    })
                    .optional(),
            })
            .optional()
            .default({}),
        limits: z
            .object({
                enabled: z.boolean().optional(),
                requestsPerMinute: z.number().int().min(1).optional(),
                maxConversations: z.number().int().min(0).optional(),
                maxMessagesPerDay: z.number().int().min(0).optional(),
                storageProvider: z.enum(LIMITS_PROVIDER_ID_LIST).optional(),
            })
            .optional(),
        security: z
            .object({
                allowedOrigins: z.array(z.string()).optional(),
                forceHttps: z.boolean().optional(),
            })
            .optional(),
        admin: z
            .object({
                basePath: z.string().optional(),
                allowedHosts: z.array(z.string()).optional(),
                allowRestart: z.boolean().optional(),
                allowRebuild: z.boolean().optional(),
                rebuildCommand: z.string().optional(),
                extensionMaxZipBytes: z.number().int().min(1).optional(),
                extensionMaxFiles: z.number().int().min(1).optional(),
                extensionMaxTotalBytes: z.number().int().min(1).optional(),
                extensionAllowedExtensions: z.array(z.string()).optional(),
            })
            .optional(),
        backgroundStreaming: z
            .object({
                enabled: z.boolean().optional(),
                storageProvider: z.enum(BACKGROUND_PROVIDER_ID_LIST).optional(),
                maxConcurrentJobs: z.number().int().min(1).optional(),
                jobTimeoutSeconds: z.number().int().min(1).optional(),
            })
            .optional(),
    })
    .passthrough();

const formatConfigErrors = (errors: string[]) => {
    const heading = '[or3-cloud-config] Configuration validation failed:';
    return `${heading}\n${errors.map((err) => `- ${err}`).join('\n')}`;
};

function mergeConfig(config: Or3CloudConfig): Or3CloudConfig {
    return {
        ...DEFAULT_OR3_CLOUD_CONFIG,
        ...config,
        auth: {
            ...DEFAULT_OR3_CLOUD_CONFIG.auth,
            ...config.auth,
            clerk: {
                ...DEFAULT_OR3_CLOUD_CONFIG.auth.clerk,
                ...(config.auth.clerk ?? {}),
            },
        },
        sync: {
            ...DEFAULT_OR3_CLOUD_CONFIG.sync,
            ...config.sync,
            convex: {
                ...DEFAULT_OR3_CLOUD_CONFIG.sync.convex,
                ...(config.sync.convex ?? {}),
            },
        },
        storage: {
            ...DEFAULT_OR3_CLOUD_CONFIG.storage,
            ...config.storage,
        },
        services: {
            ...DEFAULT_OR3_CLOUD_CONFIG.services,
            ...config.services,
            llm: {
                ...DEFAULT_OR3_CLOUD_CONFIG.services.llm!,
                ...(config.services.llm ?? {}),
                openRouter: {
                    ...DEFAULT_OR3_CLOUD_CONFIG.services.llm!.openRouter,
                    ...(config.services.llm?.openRouter ?? {}),
                },
            },
        },
        limits: {
            ...DEFAULT_OR3_CLOUD_CONFIG.limits,
            ...config.limits,
        },
        security: {
            ...DEFAULT_OR3_CLOUD_CONFIG.security,
            ...config.security,
        },
        admin: {
            ...DEFAULT_OR3_CLOUD_CONFIG.admin,
            ...config.admin,
        },
        backgroundStreaming: {
            ...DEFAULT_OR3_CLOUD_CONFIG.backgroundStreaming,
            ...config.backgroundStreaming,
        },
    };
}

function validateConfig(config: Or3CloudConfig, strict: boolean): void {
    const parsed = cloudConfigSchema.safeParse(config);
    if (!parsed.success) {
        const errors = parsed.error.issues.map((issue) =>
            issue.path.length
                ? `${issue.path.join('.')}: ${issue.message}`
                : issue.message
        );
        throw new Error(formatConfigErrors(errors));
    }

    if (!strict) return;

    const errors: string[] = [];

    if (config.auth.enabled && config.auth.provider === CLERK_PROVIDER_ID) {
        if (!config.auth.clerk?.publishableKey) {
            errors.push('auth.clerk.publishableKey is required when auth is enabled.');
        }
        if (!config.auth.clerk?.secretKey) {
            errors.push('auth.clerk.secretKey is required when auth is enabled.');
        }
    }

    if (config.sync.enabled && config.sync.provider === CONVEX_PROVIDER_ID) {
        if (!config.sync.convex?.url) {
            errors.push('sync.convex.url is required when sync is enabled.');
        }
    }

    const openRouter = config.services.llm?.openRouter;
    if (openRouter?.allowUserOverride === false && !openRouter.instanceApiKey) {
        errors.push(
            'services.llm.openRouter.instanceApiKey is required when allowUserOverride is false.'
        );
    }

    if (errors.length > 0) {
        throw new Error(formatConfigErrors(errors));
    }
}

export function defineOr3CloudConfig(
    config: Or3CloudConfig,
    options: Or3CloudConfigOptions = {}
): Or3CloudConfig {
    const strict =
        options.strict ??
        (process.env.NODE_ENV === 'production' || process.env.OR3_STRICT_CONFIG === 'true');
    const merged = mergeConfig(config);
    validateConfig(merged, strict);
    return merged;
}

export { DEFAULT_OR3_CLOUD_CONFIG };
