/**
 * Host-side Library link configuration.
 *
 * The central origin is the configured marketplace registry origin; the
 * encryption key is a runtime secret that is never baked into builds. When
 * either is missing, linking reports itself as unconfigured instead of falling
 * back to storing a credential in plaintext.
 */
import { useRuntimeConfig } from '#imports';
import { deploymentIdentity } from '../deployment-identity';
import { httpsOrigin } from '../../utils/plugins/acquisition/config';

export interface LibraryLinkConfig {
    /** Central marketplace origin, or '' when no registry is configured. */
    readonly registryOrigin: string;
    /** AES-256-GCM key for the polling secret and library token. */
    readonly secret: string | undefined;
    readonly instanceId: string;
    readonly requestTimeoutMs: number;
}

export interface LibraryRuntimeConfig {
    readonly admin?: { readonly libraryLinkSecret?: string };
}

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

/**
 * The Nuxt runtime override carries the container translation
 * (`OR3_LIBRARY_LINK_SECRET` -> `NUXT_ADMIN_LIBRARY_LINK_SECRET`); the
 * documented variable is also honoured directly because reading it here cannot
 * bake it into a build.
 */
function librarySecret(config: LibraryRuntimeConfig): string | undefined {
    const fromRuntimeConfig = config.admin?.libraryLinkSecret;
    if (typeof fromRuntimeConfig === 'string' && fromRuntimeConfig.trim().length > 0) {
        return fromRuntimeConfig;
    }
    const fromEnvironment = process.env.OR3_LIBRARY_LINK_SECRET;
    return typeof fromEnvironment === 'string' && fromEnvironment.trim().length > 0
        ? fromEnvironment
        : undefined;
}

export async function resolveLibraryLinkConfig(
    config: LibraryRuntimeConfig = useRuntimeConfig() as LibraryRuntimeConfig,
    env: NodeJS.ProcessEnv = process.env
): Promise<LibraryLinkConfig> {
    return {
        registryOrigin: httpsOrigin(env.OR3_MARKETPLACE_REGISTRY_ORIGIN),
        secret: librarySecret(config),
        // A durable deployment identity, never the hostname: managed containers
        // are recreated with new hostnames while the data volume survives.
        instanceId: await deploymentIdentity(),
        requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    };
}

export function libraryLinkConfigured(config: LibraryLinkConfig): boolean {
    return config.registryOrigin.length > 0 && config.secret !== undefined;
}
