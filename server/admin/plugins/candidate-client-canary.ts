/**
 * @module server/admin/plugins/candidate-client-canary
 *
 * Purpose:
 * Collect real browser evidence for a candidate package that runs in the
 * contained client sandbox.
 *
 * A server process cannot prove a browser will start a package, so the host
 * issues a one-time ticket, the admin's own browser performs a hidden activation
 * against the candidate's exact bytes, and the browser reports the outcome back.
 * Promotion then requires that recorded evidence.
 *
 * Behavior:
 * - Tickets are single-use, short-lived and bound to the plugin, package digest,
 *   workspace and client id, so a report cannot be replayed for another release.
 * - Evidence is stored per plugin/digest/workspace and read by the canary's
 *   client step; a missing report is a pending block, never a skipped pass.
 * - Nothing here executes plugin code: the browser does, inside the sandbox.
 *
 * Constraints:
 * - Files live under the extensions root with 0o600 files and 0o700 directories.
 * - A ticket never approves authority: the sandbox runs with the workspace's
 *   recorded grant review.
 *
 * Non-Goals:
 * - Deciding promotion (the promotion service owns that).
 */

import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import type { PluginGrantReviewSnapshot } from '../../../shared/plugins/grant-review';
import type { Sha256 } from '../../../shared/plugins/runtime-descriptor';
import type { PackageV2ClientEntry } from '../../../shared/plugins/runtime-descriptor';
import { EXTENSIONS_BASE_DIR } from '../extensions/paths';
import { ImmutablePluginPackageStore } from './package-store';

const TICKET_TTL_MS = 15 * 60 * 1000;
const MAX_DIAGNOSTICS_BYTES = 4 * 1024;

export interface ClientCanaryTicketRequest {
    readonly pluginId: string;
    readonly packageDigest: Sha256;
    readonly workspaceId: string;
    readonly clientId: string;
    readonly profile: string;
    readonly clientEntry: PackageV2ClientEntry;
    readonly grants: PluginGrantReviewSnapshot;
}

export interface ClientCanaryTicket extends ClientCanaryTicketRequest {
    readonly ticketId: string;
    readonly nonce: string;
    readonly issuedAt: number;
    readonly expiresAt: number;
}

export interface ClientCanaryReport {
    readonly ticketId: string;
    readonly nonce: string;
    readonly browser: string;
    readonly abiVersion: number;
    readonly status: 'passed' | 'blocked';
    readonly code?: string;
    readonly diagnostics?: Readonly<Record<string, unknown>>;
}

export interface ClientCanaryEvidenceRecord {
    readonly schemaVersion: 1;
    readonly pluginId: string;
    readonly packageDigest: Sha256;
    readonly workspaceId: string;
    readonly clientId: string;
    readonly profile: string;
    readonly browser: string;
    readonly abiVersion: number;
    readonly status: 'passed' | 'blocked';
    readonly code?: string;
    readonly diagnostics?: Readonly<Record<string, unknown>>;
    readonly recordedAt: number;
}

function validIdentifier(value: string, max: number): boolean {
    return (
        value.trim().length > 0 &&
        value.length <= max &&
        !/[\u0000-\u001f\u007f]/.test(value)
    );
}

function workspaceKey(workspaceId: string): string {
    return createHash('sha256')
        .update('OR3_PLUGIN_CLIENT_CANARY_WORKSPACE_V1\0')
        .update(workspaceId)
        .digest('hex');
}

/** One shared implementation for the browser report and the canary step. */
export class PluginClientCanaryStore {
    readonly #root: string;
    readonly #packages: ImmutablePluginPackageStore;

    constructor(extensionsRoot = EXTENSIONS_BASE_DIR) {
        this.#root = resolve(extensionsRoot, '.state', 'candidate-canary');
        this.#packages = new ImmutablePluginPackageStore(extensionsRoot);
    }

    ticketPath(ticketId: string): string {
        if (!validIdentifier(ticketId, 128)) throw new Error('Invalid canary ticket id');
        return resolve(this.#root, 'tickets', `${ticketId}.json`);
    }

    evidencePath(pluginId: string, packageDigest: Sha256, workspaceId: string): string {
        // Reuse the package path validation for plugin/digest inputs.
        this.#packages.packagePath(pluginId, packageDigest);
        if (!validIdentifier(workspaceId, 256)) {
            throw new Error('Invalid workspace id for client canary evidence');
        }
        return resolve(
            this.#root,
            'client',
            pluginId,
            `${packageDigest}.${workspaceKey(workspaceId)}.json`
        );
    }

    /** Issue a single-use ticket the admin's browser can redeem once. */
    async issueTicket(
        request: ClientCanaryTicketRequest,
        now = Date.now()
    ): Promise<ClientCanaryTicket> {
        if (!validIdentifier(request.pluginId, 128)) throw new Error('Invalid plugin id');
        if (!validIdentifier(request.workspaceId, 256)) throw new Error('Invalid workspace id');
        if (!validIdentifier(request.clientId, 256)) throw new Error('Invalid client id');
        const ticket: ClientCanaryTicket = {
            ...request,
            ticketId: `cct_${randomUUID().replaceAll('-', '')}`,
            nonce: randomUUID().replaceAll('-', ''),
            issuedAt: now,
            expiresAt: now + TICKET_TTL_MS,
        };
        const path = this.ticketPath(ticket.ticketId);
        await fs.mkdir(resolve(path, '..'), { recursive: true, mode: 0o700 });
        await fs.writeFile(path, `${JSON.stringify(ticket)}\n`, { encoding: 'utf8', mode: 0o600 });
        await this.#pruneTickets(now);
        return ticket;
    }

    /** Read a ticket without consuming it (the entry route's authorization). */
    async readTicket(ticketId: string): Promise<ClientCanaryTicket | null> {
        try {
            const raw = await fs.readFile(this.ticketPath(ticketId), 'utf8');
            return JSON.parse(raw) as ClientCanaryTicket;
        } catch {
            return null;
        }
    }

    /**
     * Redeem a ticket once. The report's nonce, digest, workspace and client id
     * must all match, so a recorded pass cannot be replayed for another release.
     */
    async redeemTicket(
        report: ClientCanaryReport,
        now = Date.now()
    ): Promise<ClientCanaryTicket | null> {
        let raw: string;
        try {
            raw = await fs.readFile(this.ticketPath(report.ticketId), 'utf8');
        } catch {
            return null;
        }
        const ticket = JSON.parse(raw) as ClientCanaryTicket;
        await fs.rm(this.ticketPath(report.ticketId), { force: true });
        if (ticket.nonce !== report.nonce) return null;
        if (ticket.expiresAt <= now) return null;
        return ticket;
    }

    async recordEvidence(record: ClientCanaryEvidenceRecord): Promise<void> {
        const path = this.evidencePath(record.pluginId, record.packageDigest, record.workspaceId);
        const directory = resolve(path, '..');
        await fs.mkdir(directory, { recursive: true, mode: 0o700 });
        const temporary = resolve(directory, `.${record.packageDigest}.${randomUUID()}.tmp`);
        const handle = await fs.open(temporary, 'wx', 0o600);
        try {
            await handle.writeFile(`${JSON.stringify(record)}\n`, 'utf8');
            await handle.sync();
        } finally {
            await handle.close();
        }
        await fs.rename(temporary, path);
    }

    async readEvidence(
        pluginId: string,
        packageDigest: Sha256,
        workspaceId: string
    ): Promise<ClientCanaryEvidenceRecord | null> {
        let raw: string;
        try {
            raw = await fs.readFile(this.evidencePath(pluginId, packageDigest, workspaceId), 'utf8');
        } catch {
            return null;
        }
        try {
            const parsed = JSON.parse(raw) as ClientCanaryEvidenceRecord;
            if (parsed.schemaVersion !== 1) return null;
            if (parsed.pluginId !== pluginId || parsed.packageDigest !== packageDigest) return null;
            if (parsed.workspaceId !== workspaceId) return null;
            if (parsed.status !== 'passed' && parsed.status !== 'blocked') return null;
            return parsed;
        } catch {
            return null;
        }
    }

    /** Bound what a browser can write into evidence. */
    normalizeDiagnostics(value: unknown): Readonly<Record<string, unknown>> | undefined {
        if (value === undefined || value === null) return undefined;
        try {
            const serialized = JSON.stringify(value);
            if (serialized.length > MAX_DIAGNOSTICS_BYTES) {
                return { truncated: true };
            }
            if (typeof value !== 'object' || Array.isArray(value)) return undefined;
            return JSON.parse(serialized) as Record<string, unknown>;
        } catch {
            return undefined;
        }
    }

    async #pruneTickets(now: number): Promise<void> {
        const directory = resolve(this.#root, 'tickets');
        let entries: string[];
        try {
            entries = await fs.readdir(directory);
        } catch {
            return;
        }
        for (const entry of entries) {
            if (!entry.endsWith('.json')) continue;
            const path = resolve(directory, entry);
            try {
                const parsed = JSON.parse(await fs.readFile(path, 'utf8')) as ClientCanaryTicket;
                if (parsed.expiresAt <= now) await fs.rm(path, { force: true });
            } catch {
                await fs.rm(path, { force: true });
            }
        }
    }
}

export const CLIENT_CANARY_TICKET_TTL_MS = TICKET_TTL_MS;
export const CLIENT_CANARY_PENDING_CODE = 'client-canary-pending';

export function isClientCanaryTicket(value: unknown): value is ClientCanaryTicket {
    if (!value || typeof value !== 'object') return false;
    const ticket = value as Partial<ClientCanaryTicket>;
    return (
        typeof ticket.ticketId === 'string' &&
        typeof ticket.nonce === 'string' &&
        typeof ticket.pluginId === 'string' &&
        typeof ticket.packageDigest === 'string' &&
        typeof ticket.workspaceId === 'string' &&
        typeof ticket.expiresAt === 'number'
    );
}
