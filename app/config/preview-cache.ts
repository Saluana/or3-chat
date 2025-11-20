export type PreviewCacheOptions = {
    maxUrls: number;
    maxBytes: number;
};

// Base limits for devices with >4GB RAM
// Optimized to balance cache hit rate with memory pressure
const BASE_LIMITS: PreviewCacheOptions = {
    maxUrls: 120,
    maxBytes: 80 * 1024 * 1024, // 80MB
};

// Conservative limits for low-memory devices (≤4GB RAM)
// Reduces memory footprint while maintaining reasonable cache performance
const LOW_MEMORY_LIMITS: PreviewCacheOptions = {
    maxUrls: 80,
    maxBytes: 48 * 1024 * 1024, // 48MB
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
