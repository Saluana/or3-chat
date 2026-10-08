import type { Sha256 } from '../../../shared/plugins/runtime-descriptor';
import type { PackageV2ClientEntry } from '../../../shared/plugins/runtime-descriptor';
import { sha256Identity } from '../../../shared/plugins/digest';
import { init, parse } from 'es-module-lexer';
import type { Or3ExtensionManifestV2 } from '../extensions/types';
import { PluginPackageAssetError, PluginPackageAssetReader } from './package-assets';
import { ImmutablePluginPackageStore } from './package-store';
import { PluginPackagePointerStore } from './package-pointer-store';

/**
 * Reads the client entry a contained sandbox will run and hashes the exact
 * stored bytes. The digest is host-computed from the immutable, verified package
 * tree, never taken from the manifest or from the registry, so the browser can
 * compare it with the bytes it was served.
 */
export async function readPackageClientEntry(input: {
    readonly pluginId: string;
    readonly packageDigest: Sha256;
    readonly manifest: Or3ExtensionManifestV2;
    readonly reader?: PluginPackageAssetReader;
    /**
     * Selected packages are the normal case. A canary reads the candidate
     * instead, which is authorized by a single-use ticket rather than selection.
     */
    readonly requireSelected?: boolean;
}): Promise<PackageV2ClientEntry | undefined> {
    const client = input.manifest.runtime.client;
    if (!client) return undefined;
    const reader = input.reader ?? createPackageAssetReader();
    const request = {
        pluginId: input.pluginId,
        packageDigest: input.packageDigest,
        requestPath: client.entry,
    };
    const asset =
        input.requireSelected === false
            ? await reader.readAsset(request)
            : await reader.readSelectedAsset(request);
    const source = new TextDecoder().decode(asset.bytes);
    const trustedHost = input.manifest.trust === 'trusted-host' && client.isolation === 'host';
    const bareImports = (await unresolvedBareImports(source)).filter(
        (specifier) => !trustedHost || (specifier !== 'vue' && specifier !== '@or3/plugin-sdk')
    );
    if (bareImports.length > 0) {
        throw new PluginPackageClientEntryError(
            'client-entry-unresolvable',
            `The client entry imports ${bareImports.join(', ')}, which the sandbox cannot resolve. Pack the package with \`or3-plugin build\` so the entry is self-contained.`
        );
    }
    const digest = await sha256Identity(asset.bytes);
    return Object.freeze({
        entry: client.entry,
        isolation: client.isolation,
        digest: digest as Sha256,
    });
}

function createPackageAssetReader(): PluginPackageAssetReader {
    const packages = new ImmutablePluginPackageStore();
    return new PluginPackageAssetReader(
        packages,
        new PluginPackagePointerStore(undefined, packages)
    );
}

/**
 * Bare specifiers the contained sandbox cannot resolve: it imports exactly one
 * blob URL, with no import map, network or package resolution. Relative and
 * absolute specifiers are fine; a bare one means the package was packed without
 * building, so it is blocked instead of failing inside the user's browser.
 */
export async function unresolvedBareImports(source: string): Promise<readonly string[]> {
    await init;
    const found = new Set<string>();
    for (const entry of parse(source)[0]) {
        const specifier = entry.n;
        if (specifier === undefined) continue;
        if (specifier.startsWith('.') || specifier.startsWith('/')) continue;
        if (/^[a-z][a-z0-9+.-]*:/i.test(specifier)) continue;
        found.add(specifier);
    }
    return Object.freeze([...found]);
}

/**
 * A blocked client entry (missing, unreadable or unresolvable) is a block, not
 * a silently absent descriptor. Both cases are recoverable by re-packing the
 * package correctly and reinstalling.
 */
export class PluginPackageClientEntryError extends Error {
    constructor(
        readonly code: 'client-entry-unresolvable',
        message: string
    ) {
        super(message);
        this.name = 'PluginPackageClientEntryError';
    }
}

export function isPackageClientEntryUnavailable(error: unknown): boolean {
    return error instanceof PluginPackageAssetError || error instanceof PluginPackageClientEntryError;
}
/** Card assets are hashed from the same immutable selected tree as the client. */
export async function readPackageToolCardEntries(
    input: Parameters<typeof readPackageClientEntry>[0]
): Promise<
    readonly import('../../../shared/plugins/runtime-descriptor').PackageV2ToolCardDescriptor[]
> {
    const reader = input.reader ?? createPackageAssetReader();
    const read = (requestPath: string) =>
        input.requireSelected === false
            ? reader.readAsset({
                  pluginId: input.pluginId,
                  packageDigest: input.packageDigest,
                  requestPath,
              })
            : reader.readSelectedAsset({
                  pluginId: input.pluginId,
                  packageDigest: input.packageDigest,
                  requestPath,
              });
    const cards = [];
    for (const card of input.manifest.toolCards ?? []) {
        const entry = await read(card.entry);
        const source = new TextDecoder().decode(entry.bytes);
        await init;
        if (parse(source)[0].length)
            throw new PluginPackageClientEntryError(
                'client-entry-unresolvable',
                'Card entries must be self-contained, with no remaining imports'
            );
        const path = card.entry.replace(/\.[^.]+$/, '.css');
        let stylesheet: { path: string; sha256: Sha256 } | undefined;
        let bytes = entry.bytes.byteLength;
        try {
            const asset = await read(path);
            bytes += asset.bytes.byteLength;
            stylesheet = { path, sha256: await sha256Identity(asset.bytes) };
        } catch (error) {
            if (
                !(error instanceof PluginPackageAssetError) ||
                error.statusCode !== 404
            )
                throw error;
        }
        if (bytes > 1536 * 1024)
            throw new PluginPackageClientEntryError(
                'client-entry-unresolvable',
                'Card bundle exceeds 1.5 MiB'
            );
        cards.push(
            Object.freeze({
                ...card,
                entrySha256: await sha256Identity(entry.bytes),
                ...(stylesheet ? { stylesheet } : {}),
            })
        );
    }
    return Object.freeze(cards);
}
