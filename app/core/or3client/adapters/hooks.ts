/**
 * Hooks Adapter
 *
 * Wraps the hooks engine service for typed hook subscriptions.
 */

import { useHooks } from '~/core/hooks/useHooks';
import { useHookEffect } from '~/composables/core/useHookEffect';
import type { HooksAdapter } from '../client';

/**
 * Creates the hooks adapter.
 */
export function createHooksAdapter(): HooksAdapter {
    return {
        engine: useHooks,
        useEffect: useHookEffect,
    };
}
