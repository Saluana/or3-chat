/**
 * @module server/utils/background-jobs/store
 *
 * Purpose:
 * Provider factory and configuration access for background streaming jobs.
 * The store selects a provider based on runtime config and caches it to
 * avoid repeated initialization.
 *
 * Responsibilities:
 * - Resolve and cache the active provider.
 * - Expose background streaming enabled status.
 * - Resolve background job configuration with defaults.
 *
 * Non-Goals:
 * - Implementing provider logic or persistence.
 * - Enforcing authorization rules for job access.
 */

import type { BackgroundJobProvider, BackgroundJobConfig } from './types';
import { DEFAULT_CONFIG } from './types';
import { memoryJobProvider } from './providers/memory';
import { getBackgroundJobProviderById } from './registry';

let cachedProvider: BackgroundJobProvider | null = null;

/**
 * Purpose:
 * Resolve the active background job provider.
 *
 * Behavior:
 * - Reads runtime config for provider selection.
 * - Dynamically imports Convex provider when configured.
 * - Caches the resolved provider for subsequent calls.
 *
 * Constraints:
 * - Falls back to the in-memory provider when configuration is missing.
 */
export async function getJobProvider(): Promise<BackgroundJobProvider> {
    if (cachedProvider) {
        return cachedProvider;
    }

    const config = useRuntimeConfig();
    const bgConfig = config.backgroundJobs as { storageProvider?: string } | undefined;
    const storageProvider = bgConfig?.storageProvider;
    const resolved = storageProvider
        ? getBackgroundJobProviderById(storageProvider)
        : null;

    if (!resolved) {
        if (storageProvider && storageProvider !== 'memory') {
            console.warn(
                `[background-jobs] Provider "${storageProvider}" not registered, using memory`
            );
        }
        cachedProvider = memoryJobProvider;
    } else {
        cachedProvider = resolved;
    }

    return cachedProvider;
}

/**
 * Purpose:
 * Determine whether background streaming is enabled in config.
 */
export function isBackgroundStreamingEnabled(): boolean {
    const config = useRuntimeConfig();
    const bgConfig = config.backgroundJobs as { enabled?: boolean } | undefined;
    return bgConfig?.enabled === true;
}

/**
 * Purpose:
 * Resolve background job configuration with defaults.
 *
 * Behavior:
 * - Uses `DEFAULT_CONFIG` for any missing fields.
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
 * Purpose:
 * Clear the cached provider, typically for tests or config changes.
 */
export function resetJobProvider(): void {
    cachedProvider = null;
}
