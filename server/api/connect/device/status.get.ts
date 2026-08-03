import { createInternClient } from '@or3/intern-client';
import {
    createError,
    defineEventHandler,
    getQuery,
    getRequestIP,
} from 'h3';
import { requireWorkspaceSession } from '../../workspaces/_helpers';
import { getConnectServerConfig } from '../../../connect/config';
import { requireConnectStore } from '../../../connect/store/require';
import {
    createConnectUserCodeLookup,
    decryptConnectCredential,
} from '../../../connect/crypto';
import {
    noStore,
    normalizeConnectRuntimeMetadata,
    normalizeUserCode,
} from '../../../connect/helpers';
import type {
    ConnectAccessCredential,
    ConnectCredential,
} from '../../../connect/types';
import { getRateLimitProvider } from '../../../utils/rate-limit/store';
import { probeRunsCapabilities } from '../../../connect/runs-probe';

export default defineEventHandler(async (event) => {
    noStore(event);
    const session = await requireWorkspaceSession(event);
    if (!session.user?.id || !session.workspace?.id) {
        throw createError({ statusCode: 401, statusMessage: 'Sign in to continue.' });
    }
    const query = getQuery(event);
    const code = normalizeUserCode(query.code);
    const environmentId =
        typeof query.environmentId === 'string'
            ? query.environmentId.trim()
            : '';
    if (!code || !/^env-[a-z0-9-]{8,80}$/.test(environmentId)) {
        throw createError({
            statusCode: 400,
            statusMessage: 'This connection status request is invalid.',
        });
    }
    const limit = await getRateLimitProvider().checkAndRecord(
        `connect:status:${session.user.id}:${getRequestIP(event) || 'unknown'}`,
        { windowMs: 60_000, maxRequests: 60 }
    );
    if (!limit.allowed) {
        throw createError({
            statusCode: 429,
            statusMessage: 'Status checks are temporarily limited. Try again shortly.',
        });
    }

    const config = getConnectServerConfig(event);
    const store = requireConnectStore();
    const authorization = await store.getAuthorizationByUserHash(
        createConnectUserCodeLookup(code, config.encryptionKey),
        Date.now()
    );
    if (!authorization) {
        throw createError({
            statusCode: 410,
            statusMessage: 'This connection request has expired.',
        });
    }
    if (authorization.status === 'denied' || authorization.status === 'expired') {
        throw createError({
            statusCode: 410,
            statusMessage: 'This connection request is no longer active.',
        });
    }
    if (authorization.status === 'pending') {
        throw createError({
            statusCode: 409,
            statusMessage: 'This connection request has not been approved.',
        });
    }
    if (
        authorization.approved_user_id !== session.user.id ||
        authorization.approved_workspace_id !== session.workspace.id ||
        authorization.environment_id !== environmentId
    ) {
        throw createError({
            statusCode: 404,
            statusMessage: 'The approved computer is no longer available.',
        });
    }
    if (authorization.status === 'provisioning') {
        return { stage: 'approved' as const };
    }
    if (authorization.status === 'approved') {
        return { stage: 'approved' as const };
    }
    if (authorization.credential_ciphertext) {
        const approvedCredential =
            decryptConnectCredential<ConnectCredential>(
                authorization.credential_ciphertext,
                config.encryptionKey,
                {
                    purpose: 'authorization-delivery',
                    authorizationId: authorization._id,
                    environmentId:
                        authorization.environment_id ?? '',
                    userId: authorization.approved_user_id ?? '',
                    workspaceId:
                        authorization.approved_workspace_id ?? '',
                }
            );
        if (
            approvedCredential.accountId !==
                authorization.approved_user_id ||
            approvedCredential.workspaceId !==
                authorization.approved_workspace_id ||
            approvedCredential.environmentId !==
                authorization.environment_id
        ) {
            throw createError({
                statusCode: 404,
                statusMessage:
                    'The approved computer is no longer available.',
            });
        }
    } else if (authorization.status !== 'consumed') {
        throw createError({
            statusCode: 404,
            statusMessage: 'The approved computer is no longer available.',
        });
    }

    const environments = await store.listEnvironments({
        userId: session.user.id,
        workspaceId: session.workspace.id,
    });
    const environment = environments.find(
        (candidate) =>
            candidate.id === environmentId && candidate.status === 'active'
    );
    if (!environment) {
        throw createError({
            statusCode: 404,
            statusMessage: 'The approved computer is no longer available.',
        });
    }
    const access = decryptConnectCredential<ConnectAccessCredential>(
        environment.access_credential_ciphertext,
        config.encryptionKey,
        {
            purpose: 'environment-access',
            environmentId: environment.id,
            userId: session.user.id,
            workspaceId: session.workspace.id,
        }
    );
    const accessToken = access.controlToken;
    const environmentBinding = normalizeConnectRuntimeMetadata({
        runtime: environment.runtime,
        driver: environment.driver,
        basePath: environment.base_path,
    });
    const accessBinding = normalizeConnectRuntimeMetadata(access);
    if (
        !environmentBinding ||
        !accessBinding ||
        environmentBinding.runtime !== accessBinding.runtime ||
        environmentBinding.driver !== accessBinding.driver ||
        environmentBinding.basePath !== accessBinding.basePath
    ) {
        return { stage: 'installing' as const };
    }
    const binding = environmentBinding;
    const baseUrl = `https://${environment.hostname}${binding.basePath}`;
    if (binding.driver === 'runs') {
        const capabilities = await probeRunsCapabilities(baseUrl, accessToken);
        if (capabilities.sessions && capabilities.events) {
            return { stage: 'online' as const, readiness: true };
        }
        return { stage: 'installing' as const };
    }
    let requestSequence = 0;
    const fetchWithoutCache = ((
        input: Parameters<typeof globalThis.fetch>[0],
        init?: Parameters<typeof globalThis.fetch>[1]
    ) => {
        const url = new URL(String(input));
        url.searchParams.set('_or3_setup_probe', `${Date.now()}-${++requestSequence}`);
        return globalThis.fetch(url, { ...init, cache: 'no-store' });
    }) as typeof globalThis.fetch;
    const client = createInternClient({
        baseUrl,
        fetch: fetchWithoutCache,
        resolveAuth: async () => ({
            token: accessToken,
            headers: { 'X-Or3-Auth-Method': 'paired-device' },
        }),
        defaultTimeoutMs: 4_000,
        streamConnectTimeoutMs: 4_000,
    });

    try {
        const [health, readiness, runners] = await Promise.allSettled([
            client.health(),
            client.readiness(),
            client.listRunners(),
        ]);
        const hasUsableRunner =
            runners.status === 'fulfilled' &&
            runners.value.runners.some(
                (runner) =>
                    runner.status === 'available' &&
                    runner.auth_status === 'ready'
            );
        if (
            health.status === 'fulfilled' &&
            health.value.runtimeAvailable &&
            hasUsableRunner
        ) {
            return {
                stage: 'online' as const,
                readiness:
                    readiness.status === 'fulfilled'
                        ? readiness.value.ready
                        : false,
            };
        }
    } catch {
        // Credential delivery can precede service and tunnel startup.
    }
    return { stage: 'installing' as const };
});
