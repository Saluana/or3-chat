import { createError, type H3Event } from 'h3';
import type { SessionContext } from '~/core/hooks/hook-types';
import type { CloudAccess } from '~~/shared/cloud/access';
import { cloudAccessAllowed } from '~~/shared/cloud/access';

type Resolver = (event: H3Event, session: SessionContext) => CloudAccess | Promise<CloudAccess>;
/** Returns a refusal message when this account may not start new background work. */
type BackgroundAdmission = (event: H3Event, session: SessionContext) => string | null | Promise<string | null>;
let policy: { resolve: Resolver; requirePersonalAiCredentials: boolean; backgroundAdmission?: BackgroundAdmission } | undefined;

/** Trusted host policy; ordinary deployments retain their existing provider behavior. */
export function registerCloudAccessPolicy(resolve: Resolver, options?: { requirePersonalAiCredentials?: boolean; backgroundAdmission?: BackgroundAdmission }): () => void {
    if (policy) throw new Error('A Cloud access policy is already registered.');
    const entry = { resolve, requirePersonalAiCredentials: options?.requirePersonalAiCredentials === true, backgroundAdmission: options?.backgroundAdmission };
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

/** Account-scoped refusal of new background jobs (for example an operator pause). Running jobs are unaffected. */
export async function requireBackgroundAdmission(event: H3Event, session: SessionContext): Promise<void> {
    const refusal = await policy?.backgroundAdmission?.(event, session);
    if (refusal) throw createError({ statusCode: 503, statusMessage: refusal, data: { code: 'account_jobs_paused' } });
}
