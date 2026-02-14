/**
 * @module app/core/notifications
 *
 * Purpose:
 * Barrel export for the notification center. Provides the `NotificationService`
 * class and associated types for creating, reading, and clearing in-app
 * notifications.
 *
 * @see core/notifications/notification-service for the service implementation
 * @see core/notifications/types for type re-exports
 */

export { NotificationService } from './notification-service';
export type {
    NotificationAction,
    NotificationCreatePayload,
    NotificationEntity,
    Notification,
    NotificationCreate,
} from './types';
