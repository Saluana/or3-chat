export const WEBHOOK_EVENT_TYPES = [
    'thread.created',
    'thread.updated',
    'thread.deleted',
    'message.created',
    'message.updated',
    'message.completed',
    'document.created',
    'document.updated',
    'document.deleted',
    'notification.created',
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];
export type WebhookScope = 'user' | 'admin';

export const WEBHOOK_EVENT_DESCRIPTIONS: Record<WebhookEventType, string> = {
    'thread.created': 'A new conversation thread is created.',
    'thread.updated': 'A conversation thread is updated.',
    'thread.deleted': 'A conversation thread is soft-deleted.',
    'message.created': 'A new message is stored.',
    'message.updated': 'An existing message is updated.',
    'message.completed': 'AI generation finishes for a message.',
    'document.created': 'A new document is created.',
    'document.updated': 'An existing document is updated.',
    'document.deleted': 'A document is soft-deleted.',
    'notification.created': 'A notification is pushed.',
};

export const ADMIN_WEBHOOK_EVENT_TYPES = [
    'admin.user.created',
    'admin.workspace.created',
    'admin.workspace.deleted',
    'admin.user.role_changed',
    'admin.plugin.installed',
    'admin.plugin.enabled',
    'admin.plugin.disabled',
    'admin.sync.error',
    'admin.storage.error',
    'admin.job.completed',
    'admin.job.failed',
] as const;

export type AdminWebhookEventType = (typeof ADMIN_WEBHOOK_EVENT_TYPES)[number];

export const ADMIN_WEBHOOK_EVENT_DESCRIPTIONS: Record<
    AdminWebhookEventType,
    string
> = {
    'admin.user.created': 'A new user is provisioned.',
    'admin.workspace.created': 'A workspace is created.',
    'admin.workspace.deleted': 'A workspace is deleted.',
    'admin.user.role_changed': 'A user role changes.',
    'admin.plugin.installed': 'A plugin or theme is installed.',
    'admin.plugin.enabled': 'A plugin is enabled.',
    'admin.plugin.disabled': 'A plugin is disabled.',
    'admin.sync.error': 'A sync error occurs.',
    'admin.storage.error': 'A storage error occurs.',
    'admin.job.completed': 'A background job completes.',
    'admin.job.failed': 'A background job fails.',
};
