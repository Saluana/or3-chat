import { ConvexHttpClient } from 'convex/browser';
import { anyApi } from 'convex/server';
import type {
    ConnectAuthorizationRecord,
    ConnectEnvironmentRecord,
    StoredConnectHost,
} from './types';

interface ConvexRuntimeConfig {
    sync?: {
        convexUrl?: string;
        convexAdminKey?: string;
    };
}

type QueryReference = Parameters<ConvexHttpClient['query']>[0];
type MutationReference = Parameters<ConvexHttpClient['mutation']>[0];

let cachedClient: ConvexHttpClient | null = null;
let cachedKey = '';

export class ConnectStore {
    readonly #client: ConvexHttpClient;

    constructor(client = getConnectConvexClient()) {
        this.#client = client;
    }

    createAuthorization(input: {
        deviceCodeHash: string;
        userCodeHash: string;
        userCodeDisplay: string;
        host: StoredConnectHost;
        expiresAt: number;
        now: number;
    }): Promise<unknown> {
        return this.#client.mutation(mutationRef('connect:createDeviceAuthorization'), {
            device_code_hash: input.deviceCodeHash,
            user_code_hash: input.userCodeHash,
            user_code_display: input.userCodeDisplay,
            host: input.host,
            expires_at: input.expiresAt,
            now: input.now,
        });
    }

    getAuthorizationByDeviceHash(
        deviceCodeHash: string,
        now: number
    ): Promise<ConnectAuthorizationRecord | null> {
        return this.#client.mutation(mutationRef('connect:pollDeviceAuthorization'), {
            device_code_hash: deviceCodeHash,
            now,
        }) as Promise<ConnectAuthorizationRecord | null>;
    }

    getAuthorizationByUserHash(
        userCodeHash: string,
        now: number
    ): Promise<ConnectAuthorizationRecord | null> {
        return this.#client.query(queryRef('connect:getDeviceAuthorizationByUserHash'), {
            user_code_hash: userCodeHash,
            now,
        }) as Promise<ConnectAuthorizationRecord | null>;
    }

    approveAuthorization(input: {
        authorizationId: string;
        userId: string;
        workspaceId: string;
        environment: {
            id: string;
            name: string;
            platform: string;
            architecture: string;
            host_id?: string;
            signing_public_key?: string;
            noise_public_key?: string;
            hostname: string;
            tunnel_id: string;
            dns_record_id: string;
            control_token_hash: string;
            access_credential_ciphertext: string;
        };
        credentialCiphertext: string;
        maxActiveEnvironments: number;
        now: number;
    }): Promise<{ environment_id: string }> {
        return this.#client.mutation(mutationRef('connect:approveDeviceAuthorization'), {
            authorization_id: input.authorizationId,
            user_id: input.userId,
            workspace_id: input.workspaceId,
            environment: input.environment,
            credential_ciphertext: input.credentialCiphertext,
            max_active_environments: input.maxActiveEnvironments,
            now: input.now,
        }) as Promise<{ environment_id: string }>;
    }

    denyAuthorization(authorizationId: string, now: number): Promise<boolean> {
        return this.#client.mutation(mutationRef('connect:denyDeviceAuthorization'), {
            authorization_id: authorizationId,
            now,
        }) as Promise<boolean>;
    }

    getEnvironmentByControlTokenHash(
        controlTokenHash: string
    ): Promise<ConnectEnvironmentRecord | null> {
        return this.#client.query(queryRef('connect:getEnvironmentByControlTokenHash'), {
            control_token_hash: controlTokenHash,
        }) as Promise<ConnectEnvironmentRecord | null>;
    }

    listEnvironmentsForUser(
        userId: string
    ): Promise<ConnectEnvironmentRecord[]> {
        return this.#client.query(queryRef('connect:listEnvironmentsForUser'), {
            user_id: userId,
        }) as Promise<ConnectEnvironmentRecord[]>;
    }

    revokeEnvironment(environmentId: string, now: number): Promise<boolean> {
        return this.#client.mutation(mutationRef('connect:revokeEnvironment'), {
            environment_id: environmentId,
            now,
        }) as Promise<boolean>;
    }
}

export function getConnectConvexClient(): ConvexHttpClient {
    const config = useRuntimeConfig() as ConvexRuntimeConfig;
    const url = config.sync?.convexUrl?.trim();
    const adminKey = config.sync?.convexAdminKey?.trim();
    if (!url || !adminKey) {
        throw new Error('OR3 Connect requires the configured Convex cloud store');
    }
    const key = `${url}\0${adminKey}`;
    if (cachedClient && cachedKey === key) return cachedClient;
    const client = new ConvexHttpClient(url);
    (
        client as ConvexHttpClient & {
            setAdminAuth(
                token: string,
                identity: {
                    subject: string;
                    issuer: string;
                    tokenIdentifier: string;
                    or3_server: boolean;
                }
            ): void;
        }
    ).setAdminAuth(adminKey, {
        subject: 'or3-connect-control-plane',
        issuer: 'https://or3.ai/internal',
        tokenIdentifier:
            'https://or3.ai/internal|or3-connect-control-plane',
        or3_server: true,
    });
    cachedClient = client;
    cachedKey = key;
    return client;
}

function queryRef(name: string): QueryReference {
    const [namespace, handler] = name.split(':');
    return (anyApi as Record<string, Record<string, QueryReference>>)[
        namespace!
    ]![handler!]!;
}

function mutationRef(name: string): MutationReference {
    const [namespace, handler] = name.split(':');
    return (anyApi as Record<string, Record<string, MutationReference>>)[
        namespace!
    ]![handler!]!;
}
