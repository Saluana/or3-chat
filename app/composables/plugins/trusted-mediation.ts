import { PluginSseDecoder, pluginError, pluginOk, type PluginResult } from '@or3/plugin-sdk';
import type {
    PluginFileRead,
    PluginFileRef,
    PluginFilesClient,
    PluginNetworkClient,
    PluginSecretsClient,
    PluginStream,
} from '@or3/plugin-sdk';
import {
    createLocalStorageSecretStore,
    createWorkspaceFileStore,
    createWorkspacePostStore,
    type FileStore,
    type PostStore,
    type SecretStore,
} from './trusted-production-stores';

export { EXTERNAL_AGENT_CREDENTIAL_VAULT_KEY } from './trusted-production-stores';

export interface TrustedMediationOptions {
    readonly fetch?: typeof fetch;
    readonly approvedDestinations?: readonly string[];
    readonly secrets?: SecretStore;
    readonly files?: FileStore;
    readonly posts?: PostStore;
    readonly ended?: () => boolean;
    readonly allow?: (grant: string) => void;
}

function denied(grant: string): PluginResult<never> {
    return pluginError('permission-denied', `Grant "${grant}" is required`);
}

export function createTrustedMediation(options: TrustedMediationOptions = {}): {
    readonly network: PluginNetworkClient;
    readonly secrets: PluginSecretsClient;
    readonly files: PluginFilesClient;
    readonly posts: {
        read(postType: string): Promise<PluginResult<readonly { id: string; title: string }[]>>;
        write(input: { readonly postType: string; readonly title: string }): Promise<PluginResult<{ id: string }>>;
    };
} {
    const secrets = options.secrets ?? createLocalStorageSecretStore();
    const files = options.files ?? createWorkspaceFileStore();
    const posts = options.posts ?? createWorkspacePostStore();
    const approved = new Set(options.approvedDestinations ?? []);
    const ended = options.ended ?? (() => false);
    const allow = options.allow ?? (() => undefined);

    const network: PluginNetworkClient = {
        async stream(input) {
            try {
                allow('network.stream');
            } catch {
                return denied('network.stream');
            }
            if (ended()) return pluginError('stale-context', 'Plugin context has ended');
            if (input.signal?.aborted) return pluginError('aborted', 'Stream cancelled');
            if (!approved.has(input.destination)) {
                return pluginError('permission-denied', `Destination "${input.destination}" is not approved`);
            }
            const fetchImpl = options.fetch ?? fetch;
            const signal = input.signal;
            let response: Response;
            try {
                response = await fetchImpl(input.url, { method: input.method ?? 'GET', signal });
            } catch (error) {
                if (signal?.aborted) return pluginError('aborted', 'Stream cancelled');
                return pluginError('network-error', error instanceof Error ? error.message : 'Stream failed', {
                    retryable: true,
                });
            }
            if (!response.ok || !response.body) {
                return pluginError('network-error', `Stream failed with status ${response.status}`, {
                    retryable: true,
                });
            }
            const reader = response.body.getReader();
            const sse = new PluginSseDecoder();
            let settleResult: (result: PluginResult<void>) => void = () => undefined;
            const result = new Promise<PluginResult<void>>((resolve) => {
                settleResult = resolve;
            });
            let settled = false;
            const finish = (value: PluginResult<void>) => {
                if (settled) return;
                settled = true;
                settleResult(value);
            };
            const cancel = () => {
                finish(pluginError('aborted', 'Stream cancelled'));
                void reader.cancel();
            };
            if (signal) signal.addEventListener('abort', cancel, { once: true });
            async function* chunks() {
                try {
                    while (!settled) {
                        const next = await reader.read();
                        if (next.done) break;
                        const parsed = sse.push(next.value);
                        if (!parsed.ok) {
                            finish(pluginError('network-error', parsed.message));
                            return;
                        }
                        for (const chunk of parsed.chunks) {
                            if (chunk.kind === 'data') yield chunk;
                        }
                    }
                    const parsed = sse.finish();
                    finish(parsed.ok ? pluginOk(undefined) : pluginError('network-error', parsed.message));
                } catch (error) {
                    finish(
                        signal?.aborted
                            ? pluginError('aborted', 'Stream cancelled')
                            : pluginError(
                                  'network-error',
                                  error instanceof Error ? error.message : 'Stream failed',
                                  { retryable: true }
                              )
                    );
                }
            }
            const stream: PluginStream = {
                chunks: chunks(),
                result,
                cancel,
            };
            return pluginOk(stream);
        },
    };

    const secretsClient: PluginSecretsClient = {
        async get(key) {
            try {
                allow('secrets.read');
            } catch {
                return denied('secrets.read');
            }
            return pluginOk(secrets.get(key) ?? null);
        },
        async set(key, value) {
            try {
                allow('secrets.write');
            } catch {
                return denied('secrets.write');
            }
            secrets.set(key, value);
            return pluginOk(undefined);
        },
        async delete(key) {
            try {
                allow('secrets.write');
            } catch {
                return denied('secrets.write');
            }
            secrets.delete(key);
            return pluginOk(undefined);
        },
        async ref(key) {
            try {
                allow('secrets.use');
            } catch {
                return denied('secrets.use');
            }
            return pluginOk({ id: key, revision: 1, state: secrets.has(key) ? 'available' : 'missing' });
        },
        async status(key) {
            try {
                allow('secrets.read');
            } catch {
                return denied('secrets.read');
            }
            if (!key) return pluginOk('available');
            return pluginOk(secrets.has(key) ? 'available' : 'missing');
        },
        async unlock() {
            try {
                allow('secrets.use');
            } catch {
                return denied('secrets.use');
            }
            return pluginOk(undefined);
        },
    };

    const filesClient: PluginFilesClient = {
        async pick() {
            try {
                allow('files.pick');
            } catch {
                return denied('files.pick');
            }
            const listed = await files.list();
            const refs: PluginFileRef[] = listed.map((file) => ({
                id: file.id,
                name: file.name,
                mimeType: file.mimeType,
                size: file.size,
                origin: 'picker',
            }));
            return pluginOk(refs);
        },
        async read(id, readOptions) {
            try {
                allow('files.read');
            } catch {
                return denied('files.read');
            }
            const file = await files.get(id);
            if (!file) return pluginError('not-found', 'Staged file was not found');
            if (readOptions?.signal?.aborted) return pluginError('aborted', 'File read cancelled');
            let settleResult: (result: PluginResult<void>) => void = () => undefined;
            const result = new Promise<PluginResult<void>>((resolve) => {
                settleResult = resolve;
            });
            let settled = false;
            const finish = (value: PluginResult<void>) => {
                if (settled) return;
                settled = true;
                settleResult(value);
            };
            const bytes = file.bytes;
            const read: PluginFileRead = {
                result,
                cancel() {
                    finish(pluginError('aborted', 'File read cancelled'));
                },
                async *[Symbol.asyncIterator]() {
                    if (readOptions?.signal?.aborted) {
                        finish(pluginError('aborted', 'File read cancelled'));
                        return;
                    }
                    yield bytes;
                    finish(pluginOk(undefined));
                },
            };
            return pluginOk(read);
        },
        async write(input) {
            try {
                allow('files.write');
            } catch {
                return denied('files.write');
            }
            const chunks: Uint8Array[] = [];
            for await (const chunk of input.data) {
                if (input.signal?.aborted) return pluginError('aborted', 'File write cancelled');
                chunks.push(chunk);
            }
            const size = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
            const bytes = new Uint8Array(size);
            let offset = 0;
            for (const chunk of chunks) {
                bytes.set(chunk, offset);
                offset += chunk.byteLength;
            }
            const stored = await files.put({ name: input.name, mimeType: input.mimeType, bytes });
            return pluginOk({
                id: stored.id,
                name: input.name,
                mimeType: input.mimeType,
                size,
                origin: 'generated',
            });
        },
    };

    return {
        network,
        secrets: secretsClient,
        files: filesClient,
        posts: {
            async read(postType) {
                try {
                    allow('posts.read');
                } catch {
                    return denied('posts.read');
                }
                return pluginOk(await posts.read(postType));
            },
            async write(input) {
                try {
                    allow('posts.write');
                } catch {
                    return denied('posts.write');
                }
                return pluginOk(await posts.write(input));
            },
        },
    };
}
