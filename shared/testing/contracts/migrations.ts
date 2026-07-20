export interface MigrationEvidence {
    id: string;
    fields: readonly string[];
    dryRun: string;
    repeatRun: string;
    forwardRepair: string;
}

export const MIGRATION_EVIDENCE: readonly MigrationEvidence[] = [
    {
        id: 'dexie-v13-transfer-leases',
        fields: ['attempts', 'retry_at', 'lease_owner', 'lease_expires_at'],
        dryRun: 'Open a copy of a v12 database and inspect normalized rows before replacing the active database.',
        repeatRun: 'Reopen the upgraded database; Dexie does not rerun v13 and normalized values remain stable.',
        forwardRepair: 'Reset invalid running leases to expired (owner empty, expiry zero) so transactional claim recovery can resume them.',
    },
    {
        id: 'sqlite-006-sync-snapshots',
        fields: ['hlc', 'op_id', 'server_deleted_at', 'snapshot_id', 'high_watermark'],
        dryRun: 'Run migrations against a copied SQLite file and compare row counts plus legacy revision diagnostics.',
        repeatRun: 'The migration ledger prevents a second apply and deterministic backfill IDs remain unchanged.',
        forwardRepair: 'Re-run the snapshot revision verifier and repair only rows whose source change-log revision is provable.',
    },
    {
        id: 'sqlite-008-upload-intents',
        fields: ['intent_id', 'reserved_bytes', 'expires_at', 'state'],
        dryRun: 'Run against a copied database and report active reservation totals without consuming intents.',
        repeatRun: 'CREATE TABLE/INDEX IF NOT EXISTS plus the migration ledger make repeated execution safe.',
        forwardRepair: 'Expire overdue reservations in bounded batches; never infer committed state without the matching intent.',
    },
    {
        id: 'convex-legacy-tombstone-repair',
        fields: ['hlc', 'op_id', 'server_version', 'server_deleted_at'],
        dryRun: 'Invoke the bounded internal repair on a copied/staging deployment and record repaired, ambiguous, and unresolved tombstones.',
        repeatRun: 'Already repaired tombstones are skipped and the same cursor can be replayed safely.',
        forwardRepair: 'Populate metadata only from an exact matching delete log; leave ambiguous ties surfaced and GC-ineligible.',
    },
    {
        id: 'local-derived-file-references',
        fields: ['ref_count'],
        dryRun: 'Scan canonical message/post reference edges and report the derived count delta without mutating file metadata.',
        repeatRun: 'Recomputing from the same canonical edges produces the same count and never imports a remote derived value.',
        forwardRepair: 'Replace invalid or NaN counts with the canonical edge count; storage GC remains fail-closed until the scan succeeds.',
    },
    {
        id: 'chat-canonical-transcript-v1',
        fields: ['generationId', 'requestId', 'parentTurnId', 'toolCallId', 'toolResult'],
        dryRun: 'Project legacy message data into canonical turns and report orphan tool results, duplicate call IDs, and interrupted generations.',
        repeatRun: 'Stable message and tool-call IDs make a repeated projection/upsert idempotent.',
        forwardRepair: 'Keep ambiguous legacy records readable, mark interrupted pending generations explicitly, and rebuild projections from the canonical transcript.',
    },
] as const;

export function verifyMigrationEvidence(
    evidence: readonly MigrationEvidence[] = MIGRATION_EVIDENCE
): void {
    const ids = new Set<string>();
    for (const item of evidence) {
        if (ids.has(item.id)) throw new Error(`Duplicate migration evidence: ${item.id}`);
        ids.add(item.id);
        if (item.fields.length === 0) throw new Error(`${item.id} lists no fields`);
        if (!item.dryRun.trim() || !item.repeatRun.trim() || !item.forwardRepair.trim()) {
            throw new Error(`${item.id} is missing dry-run, repeat-run, or forward-repair evidence`);
        }
    }
}

export interface MigrationLifecycleAdapter<TSnapshot> {
    name: string;
    snapshot(): Promise<TSnapshot>;
    dryRun(): Promise<unknown>;
    migrate(): Promise<void>;
    repair(): Promise<void>;
}

function stable(value: unknown): string {
    return JSON.stringify(value, (_key, item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
        return Object.fromEntries(
            Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
        );
    });
}

/** Proves dry-run immutability plus repeatable migration and repair results. */
export async function verifyMigrationLifecycle<TSnapshot>(
    adapter: MigrationLifecycleAdapter<TSnapshot>
): Promise<void> {
    const before = await adapter.snapshot();
    await adapter.dryRun();
    if (stable(await adapter.snapshot()) !== stable(before)) {
        throw new Error(`${adapter.name} dry run mutated state`);
    }
    await adapter.migrate();
    const migrated = await adapter.snapshot();
    await adapter.migrate();
    if (stable(await adapter.snapshot()) !== stable(migrated)) {
        throw new Error(`${adapter.name} repeat migration changed state`);
    }
    await adapter.repair();
    const repaired = await adapter.snapshot();
    await adapter.repair();
    if (stable(await adapter.snapshot()) !== stable(repaired)) {
        throw new Error(`${adapter.name} repeat repair changed state`);
    }
}
