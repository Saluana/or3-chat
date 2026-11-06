import { createError, type H3Event } from 'h3';
import type { SessionContext } from '~/core/hooks/hook-types';
import type { CloudAccess } from '~~/shared/cloud/access';
import { cloudAccessAllowed } from '~~/shared/cloud/access';

type Resolver = (event: H3Event, session: SessionContext) => CloudAccess | Promise<CloudAccess>;
let policy: { resolve: Resolver; requirePersonalAiCredentials: boolean } | undefined;

/** Trusted host policy; ordinary deployments retain their existing provider behavior. */
export function registerCloudAccessPolicy(resolve: Resolver, options?: { requirePersonalAiCredentials?: boolean }): () => void {
    if (policy) throw new Error('A Cloud access policy is already registered.');
    const entry = { resolve, requirePersonalAiCredentials: options?.requirePersonalAiCredentials === true };
    policy = entry;
    return () => { if (policy === entry) policy = undefined; };
}

/** Trusted host policy also applies while a customer is using Free Local. */
export function requiresPersonalAiCredentials(): boolean {
    return policy?.requirePersonalAiCredentials === true;
}

export function resolveCloudAccess(event: H3Event, session: SessionContext): CloudAccess | Promise<CloudAccess> | undefined {
    return policy?.resolve(event, session);
}

export async function requireCloudAccess(event: H3Event, session: SessionContext): Promise<void> {
    if (!cloudAccessAllowed(await resolveCloudAccess(event, session))) {
        throw createError({ statusCode: 402, statusMessage: 'Cloud plan required', data: { code: 'cloud_plan_required', billingUrl: '/billing' } });
    }
}
