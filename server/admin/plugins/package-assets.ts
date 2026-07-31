import { constants, promises as fs } from 'node:fs';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { Sha256 } from '../../../shared/plugins/runtime-descriptor';
import { PluginPackagePointerStore } from './package-pointer-store';
import { ImmutablePluginPackageStore } from './package-store';

export class PluginPackageAssetError extends Error {
    constructor(
        readonly code:
            | 'invalid-path'
            | 'package-not-selected'
            | 'asset-not-found'
            | 'asset-not-file'
            | 'asset-symlink'
            | 'asset-changed',
        readonly statusCode: 400 | 404,
        message: string
    ) {
        super(message);
        this.name = 'PluginPackageAssetError';
    }
}

export interface PluginPackageAsset {
    readonly bytes: Buffer;
    readonly contentType: string;
    readonly relativePath: string;
    readonly packageDigest: Sha256;
    readonly headers: Readonly<Record<string, string>>;
}

export interface PluginPackageAssetRequest {
    readonly pluginId: string;
    readonly packageDigest: Sha256;
    readonly requestPath: string;
}

const MIME_TYPES: Readonly<Record<string, string>> = Object.freeze({
    '.css': 'text/css; charset=utf-8',
    '.gif': 'image/gif',
    '.html': 'text/html; charset=utf-8',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain; charset=utf-8',
    '.wasm': 'application/wasm',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
});

function decodeRequestPath(requestPath: string): string {
    let decoded = requestPath;
    for (let index = 0; index < 3; index++) {
        let next: string;
        try {
            next = decodeURIComponent(decoded);
        } catch {
            throw new PluginPackageAssetError('invalid-path', 400, 'Malformed package asset path');
        }
        if (next === decoded) break;
        decoded = next;
    }
    if (/%[0-9a-f]{2}/i.test(decoded)) {
        throw new PluginPackageAssetError('invalid-path', 400, 'Over-encoded package asset path');
    }
    return decoded.normalize('NFC');
}

export function normalizePackageAssetPath(requestPath: string): string {
    const decoded = decodeRequestPath(requestPath);
    if (
        decoded.length === 0 ||
        decoded.includes('\0') ||
        decoded.includes('\\') ||
        decoded.startsWith('/') ||
        /^[a-z]:\//i.test(decoded)
    ) {
        throw new PluginPackageAssetError('invalid-path', 400, 'Invalid package asset path');
    }
    const segments = decoded.split('/');
    if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
        throw new PluginPackageAssetError('invalid-path', 400, 'Package asset path contains an unsafe segment');
    }
    return segments.join('/');
}

function isInside(root: string, candidate: string): boolean {
    const path = relative(root, candidate);
    return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

export class PluginPackageAssetReader {
    constructor(
        readonly packages: ImmutablePluginPackageStore,
        readonly pointers: PluginPackagePointerStore
    ) {}

    async readSelectedAsset(request: PluginPackageAssetRequest): Promise<PluginPackageAsset> {
        const packageRoot = this.packages.packagePath(request.pluginId, request.packageDigest);
        const selection = await this.pointers.readStartupSelection(request.pluginId);
        if (selection.selected?.packageDigest !== request.packageDigest) {
            throw new PluginPackageAssetError(
                'package-not-selected',
                404,
                'Package digest is not the selected runtime version'
            );
        }
        const relativePath = normalizePackageAssetPath(request.requestPath);
        const assetPath = resolve(packageRoot, relativePath);
        if (!isInside(packageRoot, assetPath)) {
            throw new PluginPackageAssetError('invalid-path', 400, 'Package asset escaped its root');
        }

        let cursor = packageRoot;
        let before;
        for (const segment of relativePath.split('/')) {
            cursor = resolve(cursor, segment);
            try {
                before = await fs.lstat(cursor);
            } catch (error) {
                const code = error && typeof error === 'object' && 'code' in error
                    ? (error as { code?: string }).code
                    : undefined;
                if (code === 'ENOENT') {
                    throw new PluginPackageAssetError('asset-not-found', 404, 'Package asset not found');
                }
                throw error;
            }
            if (before.isSymbolicLink()) {
                throw new PluginPackageAssetError('asset-symlink', 404, 'Package asset symlinks are forbidden');
            }
        }
        if (!before?.isFile()) {
            throw new PluginPackageAssetError('asset-not-file', 404, 'Package asset is not a file');
        }

        let handle;
        try {
            handle = await fs.open(assetPath, constants.O_RDONLY | constants.O_NOFOLLOW);
            const opened = await handle.stat();
            if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) {
                throw new PluginPackageAssetError('asset-changed', 404, 'Package asset changed during read');
            }
            const bytes = await handle.readFile();
            if (bytes.byteLength !== opened.size) {
                throw new PluginPackageAssetError('asset-changed', 404, 'Package asset length changed during read');
            }
            return Object.freeze({
                bytes,
                contentType: MIME_TYPES[extname(relativePath).toLowerCase()] ?? 'application/octet-stream',
                relativePath,
                packageDigest: request.packageDigest,
                headers: Object.freeze({
                    'Cache-Control': 'private, max-age=31536000, immutable',
                    'Cross-Origin-Resource-Policy': 'same-origin',
                    'X-Content-Type-Options': 'nosniff',
                }),
            });
        } finally {
            await handle?.close();
        }
    }
}

/** Authorization is awaited before the reader can resolve or touch package paths. */
export async function serveAuthorizedPluginPackageAsset(
    request: PluginPackageAssetRequest,
    authorize: () => void | Promise<void>,
    reader: PluginPackageAssetReader
): Promise<PluginPackageAsset> {
    await authorize();
    return reader.readSelectedAsset(request);
}
