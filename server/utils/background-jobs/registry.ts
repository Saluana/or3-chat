/**
 * @module server/utils/background-jobs/registry
 *
 * Purpose:
 * Registry for background job providers so provider packages can register
 * implementations without core importing provider SDKs.
 */

import type { BackgroundJobProvider } from './types';

const providers = new Map<string, BackgroundJobProvider>();

export function registerBackgroundJobProvider(
    id: string,
    provider: BackgroundJobProvider
): void {
    providers.set(id, provider);
}

export function getBackgroundJobProviderById(
    id: string
): BackgroundJobProvider | null {
    return providers.get(id) ?? null;
}

export function listBackgroundJobProviderIds(): string[] {
    return Array.from(providers.keys());
}
