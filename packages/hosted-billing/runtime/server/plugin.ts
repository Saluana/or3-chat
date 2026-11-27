import { defineNitroPlugin } from 'nitropack/runtime';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Stripe from 'stripe';
import { getEntitlementResolver, registerEntitlementResolver } from '~~/server/auth/entitlements/registry';
import { readBillingConfig } from './config';
import { BillingStore } from './store';
import { BillingService } from './service';
import { installAccountQuota, installBillingService } from './runtime';
import { AccountStorageQuota } from './quota';
import { registerStorageGatewayDecorator } from '~~/server/storage/gateway/registry';
import { registerCloudAccessPolicy } from '~~/server/cloud/access';
import { ensureTrial } from './trial';
import { pauseActive } from './entitlement';
import { requireStorageWorkspaceAccess } from '~~/server/utils/storage/workspace-access';
import type { CloudAccess } from '~~/shared/cloud/access';

export default defineNitroPlugin(app => {
    if (import.meta.prerender) return;
    const config = readBillingConfig();
    mkdirSync(dirname(config.databasePath), { recursive: true, mode: 0o700 });
    const store = new BillingStore(config.databasePath);
    const quota = new AccountStorageQuota(config.syncDatabasePath, store);
    const service = new BillingService(store, new Stripe(config.secretKey, { timeout: 15_000, maxNetworkRetries: 1 }), config, userId => quota.usedBytes(userId));
    const uninstall = installBillingService(service);
    const uninstallQuota = installAccountQuota(quota);
    const unavailable: CloudAccess = { enabled: false, expiresAt: 0 };
    const releaseAccess = registerCloudAccessPolicy(async (event, session) => {
        if (!session.authenticated || !session.user) return unavailable;
        const workspaceId = session.workspace?.id;
        const owner = workspaceId ? quota.workspaceOwner(workspaceId) : null;
        if (workspaceId && !owner) return unavailable;
        const borrowed = owner !== null && owner !== session.user.id;
        if (borrowed && workspaceId) {
            // A stale or invalid membership must not inherit a different account's plan.
            try { await requireStorageWorkspaceAccess(event, session, workspaceId); }
            catch { return unavailable; }
        } else {
            ensureTrial(event, session, store);
        }
        const account = borrowed ? store.findAccount(owner) : null;
        if (borrowed && !account) return unavailable;
        const status = account ? store.describe(account) : store.status(session.user.id);
        if (borrowed && (!status.allowed || status.state !== 'active')) return unavailable;
        const personal = borrowed ? store.findAccount(session.user.id) : null;
        return {
            enabled: status.allowed,
            expiresAt: status.accessExpiresAt ?? (status.state === 'active' ? status.paidUntil : status.trialEndsAt),
            ...(borrowed && !(personal && store.describe(personal).allowed) ? { backgroundAllowed: false as const } : {}),
        };
    }, {
        requirePersonalAiCredentials: true,
        backgroundAdmission: (_event, session) => {
            const owner = session.workspace?.id ? quota.workspaceOwner(session.workspace.id) : null;
            if (!owner) return 'The workspace owner could not be confirmed. Try again later.';
            return pauseActive(store.support(owner)?.jobPause, Date.now())
                ? 'New background jobs are paused for this account. Contact support. Foreground chat is still available.' : null;
        },
    });
    const undecorate = registerStorageGatewayDecorator(adapter => quota.decorate(adapter));
    const previous = getEntitlementResolver('sqlite') ?? getEntitlementResolver('default');
    const unregister = registerEntitlementResolver('sqlite', async input => {
        const existing = await previous?.(input) ?? [];
        ensureTrial(input.event, input.session, store);
        const status = store.status(input.session.user!.id);
        return [...existing, ...(status.allowed ? ['hosted-access'] : []), ...(status.state === 'active' ? ['paid'] : [])];
    });
    app.hooks.hook('close', () => {
        releaseAccess();
        undecorate();
        quota.close();
        unregister();
        uninstall();
        uninstallQuota();
        store.close();
    });
});
