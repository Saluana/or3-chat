/**
 * @module server/admin/plugins/local-admission
 *
 * Purpose:
 * Explicit local provenance for development candidates admitted into the
 * dedicated development instance. A locally admitted package is never a signed
 * marketplace release; this sidecar records that distinction next to the
 * immutable package store without touching the signed release registry.
 *
 * Behavior:
 * - One bounded JSON record per plugin and package digest, under the
 *   instance's extension root (which the dedicated profile isolates).
 * - Replacement writes a new record for the new digest and leaves the old one
 *   for audit; plugin storage is never cleared by admission.
 *
 * Constraints:
 * - Records carry digests and timestamps only: no tokens, cookies, file
 *   content or user data.
 */

import { promises as fs } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type { Sha256 } from '../../../shared/plugins/runtime-descriptor';
import { EXTENSIONS_BASE_DIR } from '../extensions/paths';

export const LOCAL_ADMISSION_PROVENANCE = 'local-development' as const;

export interface LocalAdmissionRecord {
    /**
     * Schema 1 recorded the raw uploaded receipt bytes' hash; schema 2
     * records the canonical receipt digest the marketplace binds to. Only
     * schema 2 records are exportable as verification receipts.
     */
    readonly schemaVersion: 1 | 2;
    readonly pluginId: string;
    readonly packageDigest: Sha256;
    readonly manifestDigest: Sha256;
    readonly archiveSha256: Sha256;
    readonly sourceSha256: Sha256;
    readonly receiptSha256: Sha256;
    readonly candidateVersion: string;
    readonly admittedAt: string;
    readonly admittedBy: string;
}

const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const DIGEST_PATTERN = /^sha256-[a-f0-9]{64}$/;

function admissionFile(pluginId: string, packageDigest: Sha256, extensionsRoot = EXTENSIONS_BASE_DIR): string {
    if (!PLUGIN_ID_PATTERN.test(pluginId) || pluginId.includes('..')) {
        throw new Error(`Invalid plugin id for local admission: ${pluginId}`);
    }
    if (!DIGEST_PATTERN.test(packageDigest)) {
        throw new Error(`Invalid package digest for local admission: ${packageDigest}`);
    }
    const directory = resolve(extensionsRoot, 'local-admission', pluginId);
    const candidate = resolve(directory, `${packageDigest}.json`);
    if (!candidate.startsWith(`${directory}${sep}`)) {
        throw new Error('Local admission path escaped its directory');
    }
    return candidate;
}

/** Record an explicit local admission; replacement adds a record, never edits one. */
export async function recordLocalAdmission(
    record: LocalAdmissionRecord,
    extensionsRoot = EXTENSIONS_BASE_DIR
): Promise<void> {
    const path = admissionFile(record.pluginId, record.packageDigest, extensionsRoot);
    await fs.mkdir(resolve(path, '..'), { recursive: true });
    const payload = JSON.stringify(record, null, 2);
    if (Buffer.byteLength(payload, 'utf8') > 4 * 1024) {
        throw new Error('Local admission record exceeds 4 KiB');
    }
    await fs.writeFile(path, `${payload}\n`, { flag: 'wx' });
}

/** Local provenance for one digest, or null when it came from the signed catalog. */
export async function readLocalAdmission(
    pluginId: string,
    packageDigest: string,
    extensionsRoot = EXTENSIONS_BASE_DIR
): Promise<LocalAdmissionRecord | null> {
    if (!PLUGIN_ID_PATTERN.test(pluginId) || !DIGEST_PATTERN.test(packageDigest)) return null;
    try {
        const raw = await fs.readFile(
            admissionFile(pluginId, packageDigest as Sha256, extensionsRoot),
            'utf8'
        );
        const parsed = JSON.parse(raw) as LocalAdmissionRecord;
        if (
            (parsed.schemaVersion !== 1 && parsed.schemaVersion !== 2) ||
            parsed.pluginId !== pluginId ||
            parsed.packageDigest !== packageDigest
        ) {
            return null;
        }
        return parsed;
    } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}

/**
 * Replace a schema 1 sidecar with its schema 2 form for the same admitted
 * bytes. Only an exact identity match upgrades: any digest drift keeps the
 * original record and reports EEXIST, so an upgrade can never smuggle changed
 * bytes into an existing admission.
 */
export async function upgradeLocalAdmissionDigest(
    pluginId: string,
    packageDigest: Sha256,
    record: LocalAdmissionRecord,
    extensionsRoot = EXTENSIONS_BASE_DIR
): Promise<void> {
    const existing = await readLocalAdmission(pluginId, packageDigest, extensionsRoot);
    if (
        !existing ||
        existing.schemaVersion !== 1 ||
        existing.manifestDigest !== record.manifestDigest ||
        existing.archiveSha256 !== record.archiveSha256 ||
        existing.sourceSha256 !== record.sourceSha256 ||
        existing.candidateVersion !== record.candidateVersion
    ) {
        const conflict = new Error('Local admission already recorded') as Error & { code: string };
        conflict.code = 'EEXIST';
        throw conflict;
    }
    const path = admissionFile(pluginId, packageDigest, extensionsRoot);
    const payload = JSON.stringify(record, null, 2);
    if (Buffer.byteLength(payload, 'utf8') > 4 * 1024) {
        throw new Error('Local admission record exceeds 4 KiB');
    }
    await fs.writeFile(path, `${payload}\n`);
}
