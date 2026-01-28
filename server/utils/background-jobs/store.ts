/**
 * Background Job Store
 *
 * Factory that creates the appropriate background job provider based on configuration.
 * Falls back to in-memory provider if the configured provider is unavailable.
 */

import type { BackgroundJobProvider, BackgroundJobConfig } from './types';
import { DEFAULT_CONFIG } from './types';
import { memoryJobProvider } from './providers/memory';
import { BACKGROUND_PROVIDER_IDS } from '~~/shared/cloud/provider-ids';

let cachedProvider: BackgroundJobProvider | null = null;

/**
 * Get the active background job provider.
 * Caches the provider for performance.
 */
export async function getJobProvider(): Promise<BackgroundJobProvider> {
    if (cachedProvider) {
        return cachedProvider;
    }

    const config = useRuntimeConfig();
    const bgConfig = config.backgroundJobs as { storageProvider?: string } | undefined;
    const storageProvider = bgConfig?.storageProvider ?? BACKGROUND_PROVIDER_IDS.memory;

    switch (storageProvider) {
        case BACKGROUND_PROVIDER_IDS.convex: {
            // Dynamically import to avoid loading if not used
            const convexUrl =
                (config.sync as { convexUrl?: string } | undefined)?.convexUrl ??
                config.public.sync.convexUrl;
            if (convexUrl) {
                const { convexJobProvider } = await import('./providers/convex');
                cachedProvider = convexJobProvider;
            } else {
                console.warn('[background-jobs] Convex URL not configured, using memory');
                cachedProvider = memoryJobProvider;
            }
            break;
        }

        case BACKGROUND_PROVIDER_IDS.redis:
            // Future: Redis provider
            console.warn('[background-jobs] Redis provider not yet implemented, using memory');
            cachedProvider = memoryJobProvider;
            break;

        case BACKGROUND_PROVIDER_IDS.memory:
        default:
            cachedProvider = memoryJobProvider;
            break;
    }

    return cachedProvider;
}

/**
 * Check if background streaming is enabled
 */
export function isBackgroundStreamingEnabled(): boolean {
    const config = useRuntimeConfig();
    const bgConfig = config.backgroundJobs as { enabled?: boolean } | undefined;
    return bgConfig?.enabled === true;
}

/**
 * Get background job configuration
 */
export function getJobConfig(): BackgroundJobConfig {
    const config = useRuntimeConfig();
    const bgConfig = config.backgroundJobs as Partial<BackgroundJobConfig> | undefined;

    return {
        maxConcurrentJobs: bgConfig?.maxConcurrentJobs ?? DEFAULT_CONFIG.maxConcurrentJobs,
        jobTimeoutMs: bgConfig?.jobTimeoutMs ?? DEFAULT_CONFIG.jobTimeoutMs,
        completedJobRetentionMs:
            bgConfig?.completedJobRetentionMs ?? DEFAULT_CONFIG.completedJobRetentionMs,
    };
}

/**
 * Reset the cached provider (useful for testing or config changes)
 */
export function resetJobProvider(): void {
    cachedProvider = null;
}
