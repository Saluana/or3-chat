/**
 * Notification Center Types
 * 
 * Re-exports notification types from hook-types and db schema
 * for convenient access by notification service and components.
 */

export type {
    NotificationAction,
    NotificationCreatePayload,
    NotificationEntity,
} from '../hooks/hook-types';

export type {
    Notification,
    NotificationCreate,
} from '~/app/db/schema';
