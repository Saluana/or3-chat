/**
 * Type extensions for H3 event context
 */
import type { AdminRequestContext } from '../server/admin/context';

declare module 'h3' {
    interface H3EventContext {
        admin?: AdminRequestContext;
    }
}

export {};
