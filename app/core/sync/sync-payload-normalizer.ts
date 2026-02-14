/**
 * @module app/core/sync/sync-payload-normalizer
 *
 * Purpose:
 * Shared normalization logic for sync payloads. Transforms server-format
 * data into the local Dexie format and validates against Zod schemas.
 * Used by both the ConflictResolver (live apply) and rescan (staging).
 *
 * Behavior:
 * 1. Convert server wire format to client format (field mapping)
 * 2. Set the primary key field for the target table
 * 3. Add clock and HLC metadata from the change stamp
 * 4. Auto-generate `order_key` for messages if missing
 * 5. Validate against the canonical wire schema (converting back for validation)
 *
 * Wire format:
 * Server payloads use snake_case. Local storage also uses snake_case
 * (aligned with Dexie conventions). Field mapping handles any
 * backend-specific naming differences.
 *
 * Constraints:
 * - Validation is best-effort; invalid payloads are flagged but still returned
 *   so callers can decide whether to skip or force-apply
 *
 * @see shared/sync/schemas for Zod validation schemas
 * @see shared/sync/field-mappings for toClientFormat/toServerFormat
 * @see core/sync/conflict-resolver for the primary consumer
 */
import { TABLE_PAYLOAD_SCHEMAS } from '~~/shared/sync/schemas';
import { hlcToOrderKey } from './hlc';
import { getPkField } from '~~/shared/sync/table-metadata';
import { toClientFormat, toServerFormat } from '~~/shared/sync/field-mappings';

/**
 * Purpose:
 * Result of normalizing a server change payload for local Dexie storage.
 *
 * Behavior:
 * - `payload` is in the local (client) record shape
 * - `isValid` reflects best-effort schema validation against canonical wire schema
 * - `errors` contains human-readable issue strings when validation fails
 *
 * Constraints:
 * - Validation failures do not prevent normalization; callers decide whether to apply
 */
export interface NormalizedPayload {
    payload: Record<string, unknown>;
    isValid: boolean;
    errors?: string[];
}

/**
 * Purpose:
 * Normalize an incoming server payload into the shape expected by local Dexie tables.
 *
 * Behavior:
 * - Maps wire payload into client record shape via field mappings
 * - Ensures the primary key field is present
 * - Attaches sync metadata (`clock`, `hlc`) from the stamp
 * - Ensures `order_key` exists for messages (derived from HLC)
 * - Validates best-effort against the canonical wire schema
 *
 * Constraints:
 * - Does not throw on schema validation failure; returns `isValid: false`
 */
export function normalizeSyncPayload(
    tableName: string,
    pk: string,
    rawPayload: unknown,
    stamp: { clock: number; hlc: string }
): NormalizedPayload {
    const rawRecord = (rawPayload ?? {}) as Record<string, unknown>;
    const payload = toClientFormat(tableName, rawRecord);
    const pkField = getPkField(tableName);

    // Set primary key field
    payload[pkField] = pk;

    // Add clock and HLC metadata
    payload.clock = stamp.clock;
    payload.hlc = stamp.hlc;

    // Add order_key for messages if missing
    if (tableName === 'messages' && !payload.order_key) {
        payload.order_key = hlcToOrderKey(stamp.hlc);
    }

    // Validate against canonical wire schema (snake_case).
    // We normalize to client format for local usage, so convert back for validation.
    const schema = TABLE_PAYLOAD_SCHEMAS[tableName];
    if (schema) {
        const wirePayload = toServerFormat(tableName, payload);
        const result = schema.safeParse(wirePayload);
        if (!result.success) {
            const errors = result.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`);
            return {
                payload,
                isValid: false,
                errors,
            };
        }
    }

    return {
        payload,
        isValid: true,
    };
}

/**
 * Purpose:
 * Normalize an incoming payload for staging flows (bootstrap/rescan).
 *
 * Behavior:
 * - Uses the same normalization pipeline as `normalizeSyncPayload`
 * - Always returns the normalized record payload even if invalid
 *
 * Constraints:
 * - Intended for staging tables and deferred validation during apply
 */
export function normalizeSyncPayloadForStaging(
    tableName: string,
    pk: string,
    rawPayload: unknown,
    stamp: { clock: number; hlc: string }
): Record<string, unknown> {
    const normalized = normalizeSyncPayload(tableName, pk, rawPayload, stamp);
    // For staging, we always return the payload even if validation fails
    // (the actual validation check happens during apply)
    return normalized.payload;
}
