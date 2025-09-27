export type PreviewCacheOptions = {
    maxUrls: number;
    maxBytes: number;
};

const BASE_LIMITS: PreviewCacheOptions = {
    maxUrls: 120,
    maxBytes: 80 * 1024 * 1024,
};

const LOW_MEMORY_LIMITS: PreviewCacheOptions = {
    maxUrls: 80,
    maxBytes: 48 * 1024 * 1024,
};

function detectDeviceMemory(): number | undefined {
    if (typeof navigator === 'undefined') return undefined;
    const value = (navigator as any).deviceMemory;
    return typeof value === 'number' && Number.isFinite(value)
        ? value
        : undefined;
}

export function resolvePreviewCacheOptions(
    overrides: Partial<PreviewCacheOptions> = {}
): PreviewCacheOptions {
    const memory = detectDeviceMemory();
    const defaults = memory && memory <= 4 ? LOW_MEMORY_LIMITS : BASE_LIMITS;
    return {
        maxUrls: overrides.maxUrls ?? defaults.maxUrls,
        maxBytes: overrides.maxBytes ?? defaults.maxBytes,
    };
}

export const DEFAULT_PREVIEW_CACHE_OPTIONS = resolvePreviewCacheOptions();
