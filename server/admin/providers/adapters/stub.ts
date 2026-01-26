import type {
    ProviderAdminAdapter,
    ProviderAdminStatusResult,
    ProviderKind,
    ProviderStatusContext,
} from '../types';
import type { H3Event } from 'h3';

export function createStubProviderAdapter(
    kind: ProviderKind,
    id: string
): ProviderAdminAdapter {
    return {
        id,
        kind,
        async getStatus(_event: H3Event, ctx: ProviderStatusContext): Promise<ProviderAdminStatusResult> {
            if (!ctx.enabled) {
                return { warnings: [], actions: [] };
            }
            return {
                warnings: [
                    {
                        level: 'warning',
                        message: `No admin adapter registered for ${kind} provider "${id}".`,
                    },
                ],
                actions: [],
            };
        },
    };
}
