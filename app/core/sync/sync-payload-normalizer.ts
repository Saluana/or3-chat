/**
 * Sync Payload Normalizer
 *
 * Shared normalization logic for sync payloads:
 * - Handles snake_case to camelCase mapping for specific tables
 * - Validates payloads against Zod schemas
 * - Provides consistent transformation across rescan and subscription paths
 */
import { TABLE_PAYLOAD_SCHEMAS } from '~~/shared/sync/schemas';
import { hlcToOrderKey } from './hlc';
import { getPkField } from '~~/shared/sync/table-metadata';
import { toClientFormat } from '~~/shared/sync/field-mappings';

export interface NormalizedPayload {
    payload: Record<string, unknown>;
    isValid: boolean;
    errors?: string[];
}

/**
 * Normalize a sync payload for client-side storage.
 *
 * This handles:
 * 1. snake_case to camelCase field mapping for specific tables
 * 2. Setting the primary key field
 * 3. Adding order_key for messages if missing
 * 4. Clock and HLC metadata
 * 5. Schema validation
 *
 * @param tableName - The table the payload belongs to
 * @param pk - The primary key value
 * @param rawPayload - The raw payload from the server
 * @param stamp - The change stamp (clock, hlc)
 * @returns Normalized payload with validation result
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

    // Validate against schema
    const schema = TABLE_PAYLOAD_SCHEMAS[tableName];
    if (schema) {
        const result = schema.safeParse(payload);
        if (!result.success) {
            const errors = result.error.issues?.map((e) => `${e.path.join('.')}: ${e.message}`) ?? 
                           [result.error.message ?? 'Validation failed'];
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
 * Normalize a sync payload for staging (rescan).
 * Similar to normalizeSyncPayload but returns the raw record format.
 *
 * @param tableName - The table the payload belongs to
 * @param pk - The primary key value
 * @param rawPayload - The raw payload from the server
 * @param stamp - The change stamp (clock, hlc)
 * @returns Normalized record ready for staging
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
