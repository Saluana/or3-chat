export const AUTH_PROVIDER_IDS = {
    clerk: 'clerk',
    custom: 'custom',
} as const;

export const SYNC_PROVIDER_IDS = {
    convex: 'convex',
    firebase: 'firebase',
    custom: 'custom',
} as const;

export const STORAGE_PROVIDER_IDS = {
    convex: 'convex',
    s3: 's3',
    custom: 'custom',
} as const;

export const LIMITS_PROVIDER_IDS = {
    memory: 'memory',
    convex: 'convex',
    redis: 'redis',
    postgres: 'postgres',
} as const;

export const BACKGROUND_PROVIDER_IDS = {
    memory: 'memory',
    convex: 'convex',
    redis: 'redis',
} as const;

export const AUTH_PROVIDER_ID_LIST = [
    AUTH_PROVIDER_IDS.clerk,
    AUTH_PROVIDER_IDS.custom,
] as const;

export const SYNC_PROVIDER_ID_LIST = [
    SYNC_PROVIDER_IDS.convex,
    SYNC_PROVIDER_IDS.firebase,
    SYNC_PROVIDER_IDS.custom,
] as const;

export const STORAGE_PROVIDER_ID_LIST = [
    STORAGE_PROVIDER_IDS.convex,
    STORAGE_PROVIDER_IDS.s3,
    STORAGE_PROVIDER_IDS.custom,
] as const;

export const LIMITS_PROVIDER_ID_LIST = [
    LIMITS_PROVIDER_IDS.memory,
    LIMITS_PROVIDER_IDS.convex,
    LIMITS_PROVIDER_IDS.redis,
    LIMITS_PROVIDER_IDS.postgres,
] as const;

export const BACKGROUND_PROVIDER_ID_LIST = [
    BACKGROUND_PROVIDER_IDS.memory,
    BACKGROUND_PROVIDER_IDS.convex,
    BACKGROUND_PROVIDER_IDS.redis,
] as const;

export type AuthProviderId = (typeof AUTH_PROVIDER_ID_LIST)[number];
export type SyncProviderId = (typeof SYNC_PROVIDER_ID_LIST)[number];
export type StorageProviderId = (typeof STORAGE_PROVIDER_ID_LIST)[number];
export type LimitsProviderId = (typeof LIMITS_PROVIDER_ID_LIST)[number];
export type BackgroundProviderId = (typeof BACKGROUND_PROVIDER_ID_LIST)[number];

export const DEFAULT_AUTH_PROVIDER_ID = AUTH_PROVIDER_IDS.clerk;
export const DEFAULT_SYNC_PROVIDER_ID = SYNC_PROVIDER_IDS.convex;
export const DEFAULT_STORAGE_PROVIDER_ID = STORAGE_PROVIDER_IDS.convex;
export const DEFAULT_LIMITS_PROVIDER_ID = LIMITS_PROVIDER_IDS.memory;
export const DEFAULT_BACKGROUND_PROVIDER_ID = BACKGROUND_PROVIDER_IDS.memory;

export const CONVEX_PROVIDER_ID = SYNC_PROVIDER_IDS.convex;
export const CONVEX_STORAGE_PROVIDER_ID = STORAGE_PROVIDER_IDS.convex;
export const CONVEX_GATEWAY_PROVIDER_ID = 'convex-gateway';
export const CLERK_PROVIDER_ID = AUTH_PROVIDER_IDS.clerk;
export const CONVEX_JWT_TEMPLATE = 'convex';
