/**
 * @module server/auth/token-broker/registry.ts
 *
 * Purpose:
 * Central registry for ProviderTokenBroker implementations. Enables auth
 * providers to register their token minting capabilities without tight coupling.
 *
 * Responsibilities:
 * - Maintain a mapping of broker IDs to their factory functions.
 * - Provide discovery mechanism for token minting services.
 *
 * Constraints:
 * - Brokers are registered at module load time (usually in provider Nitro plugins).
 * - Instantiation is lazy to avoid unnecessary setup for unused brokers.
 */
import type { ProviderTokenBroker } from './types';

export type ProviderTokenBrokerFactory = () => ProviderTokenBroker;

const brokers = new Map<string, ProviderTokenBrokerFactory>();

/**
 * Purpose:
 * Registers a ProviderTokenBroker factory in the global registry.
 *
 * Behavior:
 * Stores the factory function. In development mode, warns if an existing
 * broker with the same ID is being replaced.
 *
 * @example
 * ```ts
 * registerProviderTokenBroker('clerk', () => new ClerkTokenBroker());
 * ```
 */
export function registerProviderTokenBroker(
    id: string,
    create: ProviderTokenBrokerFactory
): void {
    if (import.meta.dev && brokers.has(id)) {
        console.warn(`[auth:token-broker:registry] Replacing broker: ${id}`);
    }
    brokers.set(id, create);
}

/**
 * Purpose:
 * Retrieves and instantiates a ProviderTokenBroker by its ID.
 *
 * Behavior:
 * Looks up the registry and invokes the factory if found.
 *
 * @param id - The unique ID of the broker (e.g., 'clerk').
 * @returns An initialized `ProviderTokenBroker` instance, or `null` if not registered.
 *
 * @example
 * ```ts
 * const broker = getProviderTokenBroker('clerk');
 * if (broker) {
 *   const token = await broker.getProviderToken(event, { providerId: 'convex' });
 * }
 * ```
 */
export function getProviderTokenBroker(
    id: string
): ProviderTokenBroker | null {
    const factory = brokers.get(id);
    return factory ? factory() : null;
}

/**
 * Purpose:
 * Returns a list of all registered broker IDs.
 * Primarily used for diagnostics or configuration validation.
 */
export function listProviderTokenBrokerIds(): string[] {
    return Array.from(brokers.keys());
}
