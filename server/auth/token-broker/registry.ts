import type { ProviderTokenBroker } from './types';

export type ProviderTokenBrokerFactory = () => ProviderTokenBroker;

const brokers = new Map<string, ProviderTokenBrokerFactory>();

export function registerProviderTokenBroker(
    id: string,
    create: ProviderTokenBrokerFactory
): void {
    if (import.meta.dev && brokers.has(id)) {
        console.warn(`[auth:token-broker] Replacing broker: ${id}`);
    }
    brokers.set(id, create);
}

export function getProviderTokenBroker(
    id: string
): ProviderTokenBroker | null {
    return brokers.get(id)?.() ?? null;
}

export function listProviderTokenBrokerIds(): string[] {
    return Array.from(brokers.keys());
}
