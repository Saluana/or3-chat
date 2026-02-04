import type { NotificationEmitter } from './types';

export interface NotificationEmitterRegistryItem {
    id: string;
    order?: number;
    create: () => NotificationEmitter;
}

const emitters = new Map<string, NotificationEmitterRegistryItem>();

export function registerNotificationEmitter(
    item: NotificationEmitterRegistryItem
): void {
    if (import.meta.dev && emitters.has(item.id)) {
        console.warn(`[notifications] Replacing emitter: ${item.id}`);
    }
    emitters.set(item.id, item);
}

export function getNotificationEmitter(
    id: string
): NotificationEmitter | null {
    const item = emitters.get(id);
    return item ? item.create() : null;
}

export function listNotificationEmitterIds(): string[] {
    return Array.from(emitters.keys());
}

export function _resetNotificationEmitters(): void {
    emitters.clear();
}
