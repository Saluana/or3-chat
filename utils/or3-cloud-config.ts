import { z } from 'zod';
import type {
    Or3CloudConfig,
    Or3CloudConfigOptions,
} from '../types/or3-cloud-config';

const DEFAULT_OR3_CLOUD_CONFIG: Or3CloudConfig = {
    auth: {
        enabled: false,
        provider: 'clerk',
        clerk: {
            publishableKey: undefined,
            secretKey: undefined,
        },
    },
    sync: {
        enabled: false,
        provider: 'convex',
        convex: {
            url: undefined,
        },
    },
    storage: {
        enabled: false,
        provider: 'convex',
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
    },
    legal: {
        termsUrl: undefined,
        privacyUrl: undefined,
    },
    security: {
        allowedOrigins: [],
        forceHttps: process.env.NODE_ENV === 'production',
    },
    extensions: {},
};

const cloudConfigSchema = z
    .object({
        auth: z.object({
            enabled: z.boolean(),
            provider: z.enum(['clerk', 'custom']),
            clerk: z
                .object({
                    publishableKey: z.string().optional(),
                    secretKey: z.string().optional(),
                })
                .optional(),
        }),
        sync: z.object({
            enabled: z.boolean(),
            provider: z.enum(['convex', 'firebase', 'custom']),
            convex: z
                .object({
                    url: z.string().optional(),
                })
                .optional(),
        }),
        storage: z.object({
            enabled: z.boolean(),
            provider: z.enum(['convex', 's3', 'custom']),
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
                storageProvider: z.enum(['memory', 'convex', 'redis', 'postgres']).optional(),
            })
            .optional(),
        legal: z
            .object({
                termsUrl: z.union([z.string().url(), z.literal('')]).optional(),
                privacyUrl: z.union([z.string().url(), z.literal('')]).optional(),
            })
            .optional(),
        security: z
            .object({
                allowedOrigins: z.array(z.string()).optional(),
                forceHttps: z.boolean().optional(),
            })
            .optional(),
        extensions: z.record(z.string(), z.unknown()).optional(),
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
                ...DEFAULT_OR3_CLOUD_CONFIG.services.llm,
                ...(config.services.llm ?? {}),
                openRouter: {
                    ...DEFAULT_OR3_CLOUD_CONFIG.services.llm.openRouter,
                    ...(config.services.llm?.openRouter ?? {}),
                },
            },
        },
        limits: {
            ...DEFAULT_OR3_CLOUD_CONFIG.limits,
            ...config.limits,
        },
        legal: {
            ...DEFAULT_OR3_CLOUD_CONFIG.legal,
            ...config.legal,
        },
        security: {
            ...DEFAULT_OR3_CLOUD_CONFIG.security,
            ...config.security,
        },
        extensions: {
            ...DEFAULT_OR3_CLOUD_CONFIG.extensions,
            ...config.extensions,
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

    if (config.auth.enabled && config.auth.provider === 'clerk') {
        if (!config.auth.clerk?.publishableKey) {
            errors.push('auth.clerk.publishableKey is required when auth is enabled.');
        }
        if (!config.auth.clerk?.secretKey) {
            errors.push('auth.clerk.secretKey is required when auth is enabled.');
        }
    }

    if (config.sync.enabled && config.sync.provider === 'convex') {
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
