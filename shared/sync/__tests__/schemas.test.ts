import { describe, expect, it } from 'vitest';
import {
    NotificationPayloadSchema,
    PushResultSchema,
    TABLE_PAYLOAD_SCHEMAS,
} from '../schemas';

describe('sync schemas', () => {
    it('includes notifications in TABLE_PAYLOAD_SCHEMAS', () => {
        expect(TABLE_PAYLOAD_SCHEMAS.notifications).toBe(NotificationPayloadSchema);
    });

    it('validates notification payloads', () => {
        const payload = {
            id: 'notif-1',
            user_id: 'user-1',
            type: 'sync-error',
            title: 'Sync failed',
            deleted: false,
            created_at: 1,
            updated_at: 1,
            clock: 1,
        };
        expect(NotificationPayloadSchema.safeParse(payload).success).toBe(true);
    });

    it('accepts PushResult errorCode values', () => {
        const parsed = PushResultSchema.safeParse({
            results: [
                {
                    opId: 'op-1',
                    success: false,
                    error: 'Validation failed',
                    errorCode: 'VALIDATION_ERROR',
                },
            ],
            serverVersion: 42,
        });

        expect(parsed.success).toBe(true);
    });
});
