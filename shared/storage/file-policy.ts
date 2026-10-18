import { z } from 'zod';

export const MIB = 1024 * 1024;
export const STATIC_FILE_CEILING = 50 * MIB;
export const FILE_POLICY_KEY = 'files.cache.policy';
export const DEFAULT_FILE_POLICY = {
    maxCachedFileBytes: 10 * MIB,
    maxCacheBytes: 250 * MIB,
    retentionDays: 14,
    maxUploadBytes: 100 * MIB,
};
export const FilePolicySchema = z.object({
    maxCachedFileBytes: z.number().int().min(0).max(STATIC_FILE_CEILING),
    maxCacheBytes: z.number().int().min(0).max(2 * 1024 * MIB),
    retentionDays: z.number().int().min(1).max(365),
    maxUploadBytes: z.number().int().min(1).max(1024 * MIB),
}).strict().refine(value => value.maxCachedFileBytes <= value.maxCacheBytes, {
    message: 'Per-file cache limit must not exceed the total cache budget.',
});
export type FilePolicy = z.infer<typeof FilePolicySchema>;
