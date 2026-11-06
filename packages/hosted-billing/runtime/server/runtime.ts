import type { BillingService } from './service';

let active: BillingService | undefined;
export function installBillingService(service: BillingService): () => void {
    if (active) throw new Error('Hosted billing is already initialized.');
    active = service;
    return () => { if (active === service) active = undefined; };
}
export function useBillingService(): BillingService {
    if (!active) throw new Error('Hosted billing is unavailable.');
    return active;
}
