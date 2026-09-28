import { promises as fs } from 'node:fs';
import { resolve, sep } from 'node:path';
import type { Sha256 } from '../../../shared/plugins/runtime-descriptor';
import { EXTENSIONS_BASE_DIR } from '../extensions/paths';

/** Exact bytes accepted through the authenticated admin ZIP upload route. */
export interface AdminUploadProvenance {
    readonly schemaVersion: 1;
    readonly pluginId: string;
    readonly packageDigest: Sha256;
    readonly manifestDigest: Sha256;
    readonly uploadedBy: string;
    readonly uploadedAt: string;
}

const PLUGIN_ID = /^[a-z0-9][a-z0-9._-]*$/;
const DIGEST = /^sha256-[a-f0-9]{64}$/;

function pathFor(pluginId: string, digest: string, root = EXTENSIONS_BASE_DIR): string {
    if (!PLUGIN_ID.test(pluginId) || pluginId.includes('..') || !DIGEST.test(digest)) {
        throw new Error('Invalid admin upload identity');
    }
    const directory = resolve(root, 'admin-uploads', pluginId);
    const path = resolve(directory, `${digest}.json`);
    if (!path.startsWith(`${directory}${sep}`)) throw new Error('Admin upload path escaped its directory');
    return path;
}

export async function readAdminUploadProvenance(
    pluginId: string,
    digest: string,
    root = EXTENSIONS_BASE_DIR
): Promise<AdminUploadProvenance | null> {
    if (!PLUGIN_ID.test(pluginId) || !DIGEST.test(digest)) return null;
    let raw: string;
    try {
        raw = await fs.readFile(pathFor(pluginId, digest, root), 'utf8');
    } catch (error) {
        if ((error as { code?: string }).code === 'ENOENT') return null;
        throw error;
    }
    const record: unknown = JSON.parse(raw);
    if (!record || typeof record !== 'object') throw new Error('Invalid admin upload provenance');
    const value = record as Partial<AdminUploadProvenance>;
    if (value.schemaVersion !== 1 || value.pluginId !== pluginId || value.packageDigest !== digest ||
        !DIGEST.test(value.manifestDigest ?? '') || typeof value.uploadedBy !== 'string' ||
        !value.uploadedBy || typeof value.uploadedAt !== 'string') {
        throw new Error('Invalid admin upload provenance');
    }
    return value as AdminUploadProvenance;
}

export async function recordAdminUploadProvenance(
    record: AdminUploadProvenance,
    root = EXTENSIONS_BASE_DIR
): Promise<void> {
    const path = pathFor(record.pluginId, record.packageDigest, root);
    await fs.mkdir(resolve(path, '..'), { recursive: true });
    const existing = await readAdminUploadProvenance(record.pluginId, record.packageDigest, root);
    if (existing) {
        if (existing.manifestDigest !== record.manifestDigest) throw new Error('Admin upload identity changed');
        return;
    }
    try {
        await fs.writeFile(path, `${JSON.stringify(record)}\n`, { flag: 'wx', mode: 0o600 });
    } catch (error) {
        if ((error as { code?: string }).code !== 'EEXIST') throw error;
        const concurrent = await readAdminUploadProvenance(record.pluginId, record.packageDigest, root);
        if (concurrent?.manifestDigest !== record.manifestDigest) throw new Error('Admin upload identity changed');
    }
}
