import { z } from 'zod';
import type {
    Or3CloudConfig,
    Or3CloudConfigOptions,
} from '../types/or3-cloud-config';
import {
    CLERK_PROVIDER_ID,
    CONVEX_PROVIDER_ID,
    DEFAULT_AUTH_PROVIDER_ID,
    DEFAULT_BACKGROUND_PROVIDER_ID,
    DEFAULT_LIMITS_PROVIDER_ID,
    DEFAULT_STORAGE_PROVIDER_ID,
    DEFAULT_SYNC_PROVIDER_ID,
} from '../shared/cloud/provider-ids';
import {
    DEFAULT_REQUESTS_PER_MINUTE,
    DEFAULT_MAX_CONVERSATIONS,
    DEFAULT_MAX_MESSAGES_PER_DAY,
    DEFAULT_ADMIN_BASE_PATH,
    DEFAULT_REBUILD_COMMAND,
    DEFAULT_EXTENSION_MAX_ZIP_BYTES,
    DEFAULT_EXTENSION_MAX_FILES,
    DEFAULT_EXTENSION_MAX_TOTAL_BYTES,
    DEFAULT_JWT_EXPIRY,
    DEFAULT_BACKGROUND_MAX_JOBS,
    DEFAULT_BACKGROUND_JOB_TIMEOUT_SECONDS,
} from '../shared/config/constants';

const DEFAULT_OR3_CLOUD_CONFIG: Or3CloudConfig = {
    auth: {
        enabled: false,
        provider: DEFAULT_AUTH_PROVIDER_ID,
        guestAccessEnabled: false,
        sessionProvisioningFailure: 'throw',
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
            adminKey: undefined,
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
                requireUserKey: false,
            },
        },
    },
    limits: {
        enabled: true,
        requestsPerMinute: DEFAULT_REQUESTS_PER_MINUTE,
        maxConversations: DEFAULT_MAX_CONVERSATIONS,
        maxMessagesPerDay: DEFAULT_MAX_MESSAGES_PER_DAY,
        storageProvider: DEFAULT_LIMITS_PROVIDER_ID,
    },
    security: {
        allowedOrigins: [],
        forceHttps: process.env.NODE_ENV === 'production',
        proxy: {
            trustProxy: false,
            forwardedForHeader: 'x-forwarded-for',
            forwardedHostHeader: 'x-forwarded-host',
        },
    },
    admin: {
        basePath: DEFAULT_ADMIN_BASE_PATH,
        allowedHosts: [],
        allowRestart: false,
        allowRebuild: false,
        rebuildCommand: DEFAULT_REBUILD_COMMAND,
        extensionMaxZipBytes: DEFAULT_EXTENSION_MAX_ZIP_BYTES,
        extensionMaxFiles: DEFAULT_EXTENSION_MAX_FILES,
        extensionMaxTotalBytes: DEFAULT_EXTENSION_MAX_TOTAL_BYTES,
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
        auth: {
            username: undefined,
            password: undefined,
            jwtSecret: undefined,
            jwtExpiry: DEFAULT_JWT_EXPIRY,
            deletedWorkspaceRetentionDays: undefined,
        },
    },
    backgroundStreaming: {
        enabled: false,
        storageProvider: DEFAULT_BACKGROUND_PROVIDER_ID,
        maxConcurrentJobs: DEFAULT_BACKGROUND_MAX_JOBS,
        jobTimeoutSeconds: DEFAULT_BACKGROUND_JOB_TIMEOUT_SECONDS,
    },
};

const cloudConfigSchema = z
    .object({
        auth: z.object({
            enabled: z.boolean(),
            provider: z.string(),
            guestAccessEnabled: z.boolean().optional(),
            sessionProvisioningFailure: z
                .enum(['throw', 'unauthenticated', 'service-unavailable'])
                .optional(),
            clerk: z
                .object({
                    publishableKey: z.string().optional(),
                    secretKey: z.string().optional(),
                })
                .optional(),
        }),
        sync: z.object({
            enabled: z.boolean(),
            provider: z.string(),
            convex: z
                .object({
                    url: z.string().optional(),
                    adminKey: z.string().optional(),
                })
                .optional(),
        }),
        storage: z.object({
            enabled: z.boolean(),
            provider: z.string(),
        }),
        services: z
            .object({
                llm: z
                    .object({
                        openRouter: z
                            .object({
                                instanceApiKey: z.string().optional(),
                                allowUserOverride: z.boolean().optional(),
                                requireUserKey: z.boolean().optional(),
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
                storageProvider: z.string().optional(),
            })
            .optional(),
        security: z
            .object({
                allowedOrigins: z.array(z.string()).optional(),
                forceHttps: z.boolean().optional(),
                proxy: z
                    .object({
                        trustProxy: z.boolean().optional(),
                        forwardedForHeader: z
                            .enum(['x-forwarded-for', 'x-real-ip'])
                            .optional(),
                        forwardedHostHeader: z.enum(['x-forwarded-host']).optional(),
                    })
                    .optional(),
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
                auth: z
                    .object({
                        username: z.string().optional(),
                        password: z.string().optional(),
                        jwtSecret: z.string().optional(),
                        jwtExpiry: z.string().optional(),
                        deletedWorkspaceRetentionDays: z.number().int().min(0).optional(),
                    })
                    .optional(),
            })
            .optional(),
        backgroundStreaming: z
            .object({
                enabled: z.boolean().optional(),
                storageProvider: z.string().optional(),
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
            auth: {
                ...DEFAULT_OR3_CLOUD_CONFIG.admin?.auth,
                ...config.admin?.auth,
            },
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
        } else {
            try {
                new URL(config.sync.convex.url);
            } catch {
                errors.push('sync.convex.url must be a valid URL.');
            }
        }
    }

    const openRouter = config.services.llm?.openRouter;
    if (openRouter?.requireUserKey === true && openRouter.allowUserOverride === false) {
        errors.push(
            'services.llm.openRouter.allowUserOverride must be true when requireUserKey is true.'
        );
    }
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
