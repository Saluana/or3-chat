/**
 * Builds the Library link service for one request.
 *
 * Configuration comes from the request's runtime config plus the process
 * environment, the binding store is the per-user file store under the admin data
 * directory, and the transport talks to the configured marketplace origin.
 */
import type { H3Event } from 'h3';
import { useRuntimeConfig } from '#imports';
import { LibraryLinkService } from './link-service';
import { createFileLibraryLinkStore } from './link-store';
import { createHttpLibraryLinkTransport } from './transport';
import {
    libraryLinkConfigured,
    resolveLibraryLinkConfig,
    type LibraryLinkConfig,
    type LibraryRuntimeConfig,
} from './config';

export interface ResolvedLibraryLink {
    readonly service: LibraryLinkService;
    readonly config: LibraryLinkConfig;
    readonly configured: boolean;
}

export async function libraryLinkServiceFor(event: H3Event): Promise<ResolvedLibraryLink> {
    const config = await resolveLibraryLinkConfig(
        useRuntimeConfig(event) as LibraryRuntimeConfig
    );
    return {
        config,
        configured: libraryLinkConfigured(config),
        service: new LibraryLinkService({
            store: createFileLibraryLinkStore(),
            transport: createHttpLibraryLinkTransport(config),
            encryptionKey: config.secret,
            instanceId: config.instanceId,
            configured: libraryLinkConfigured(config),
        }),
    };
}
