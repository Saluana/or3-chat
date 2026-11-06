import type { BillingService } from './service';
import type { AccountStorageQuota } from './quota';

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

let quota: AccountStorageQuota | undefined;
export function installAccountQuota(value: AccountStorageQuota): () => void {
    quota = value;
    return () => { if (quota === value) quota = undefined; };
}
export function useAccountQuota(): AccountStorageQuota {
    if (!quota) throw new Error('Storage accounting is unavailable.');
    return quota;
}
