/**
 * @module server/admin/providers/adapters/stub.ts
 *
 * Purpose:
 * Provides a fallback adapter for providers that do not have a specialized
 * maintenance implementation. Prevents the Admin Dashboard from crashing or showing
 * empty states when a provider is selected but unsupported by the admin logic.
 */
import type {
    ProviderAdminAdapter,
    ProviderAdminStatusResult,
    ProviderKind,
    ProviderStatusContext,
} from '../types';
import type { H3Event } from 'h3';

/**
 * Purpose:
 * Factory function to create a placeholder adapter.
 *
 * Behavior:
 * Shows a "No admin adapter registered" warning when the provider is active,
 * alerting the administrator that maintenance tools (like GC) are unavailable.
 *
 * @param kind - The category of provider (auth, sync, storage).
 * @param id - The unique identifier for the provider.
 */
export function createStubProviderAdapter(
    kind: ProviderKind,
    id: string
): ProviderAdminAdapter {
    return {
        id,
        kind,
        async getStatus(_event: H3Event, ctx: ProviderStatusContext): Promise<ProviderAdminStatusResult> {
            if (!ctx.enabled) {
                // If the provider isn't enabled, don't nag the user
                return { warnings: [], actions: [] };
            }
            return {
                warnings: [
                    {
                        level: 'warning',
                        message: `No admin adapter registered for ${kind} provider "${id}". Maintenance functions may be limited.`,
                    },
                ],
                actions: [],
            };
        },
    };
}
