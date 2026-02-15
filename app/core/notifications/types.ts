/**
 * @module app/core/notifications/types
 *
 * Purpose:
 * Re-exports notification types from the canonical sources (hook-types and
 * db/schema) so that notification consumers have a single, stable import
 * path. Avoids leaking implementation details of where each type is defined.
 *
 * @see core/hooks/hook-types.ts for NotificationAction, NotificationCreatePayload
 * @see db/schema for the Dexie Notification record shape
 */

export type {
    NotificationAction,
    NotificationCreatePayload,
    NotificationEntity,
} from '../hooks/hook-types';

export type {
    Notification,
    NotificationCreate,
} from '~/db/schema';

