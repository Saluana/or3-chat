import { computed, getCurrentInstance, onMounted, shallowRef } from 'vue';
import { liveQuery, type Subscription } from 'dexie';
import { getDb, getWorkspaceGeneration, subscribeActiveWorkspaceDb } from '~/db/client';
import type { UnifiedSidebarItem } from '~/types/sidebar';
import {
    pinKey,
    readPinEntries,
    resolvePinnedItems,
    setPinned,
    type PinEntry,
    type PinKind,
} from '~/utils/sidebar/pins';

// One live query serves every sidebar row, the pinned list and the tab menu.
const entries = shallowRef<readonly PinEntry[]>([]);
const items = shallowRef<readonly UnifiedSidebarItem[]>([]);
const pinnedKeys = computed(() => new Set(entries.value.map((entry) => pinKey(entry.kind, entry.id))));
let subscription: Subscription | undefined;
let started = false;
let token = 0;

function subscribe(): void {
    subscription?.unsubscribe();
    const mine = ++token;
    const db = getDb();
    const generation = getWorkspaceGeneration();
    subscription = liveQuery(async () => {
        const live = await readPinEntries(db);
        return { live, resolved: await resolvePinnedItems(db, live) };
    }).subscribe({
        next: ({ live, resolved }) => {
            if (mine !== token || db !== getDb() || generation !== getWorkspaceGeneration()) return;
            entries.value = live;
            items.value = resolved;
        },
        error: () => {},
    });
}

function start(): void {
    if (started || !import.meta.client) return;
    started = true;
    subscribe();
    subscribeActiveWorkspaceDb(() => {
        entries.value = [];
        items.value = [];
        subscribe();
    });
}

/** Pinned chats and documents of the active workspace, and the pin/unpin action. */
export function usePinnedItems() {
    if (getCurrentInstance()) onMounted(start);
    else start();

    async function toggle(kind: PinKind, id: string, pinned = !pinnedKeys.value.has(pinKey(kind, id))): Promise<void> {
        const db = getDb();
        const generation = getWorkspaceGeneration();
        await setPinned(db, kind, id, pinned, {
            isValid: () => db === getDb() && generation === getWorkspaceGeneration(),
        });
    }

    return {
        /** Pinned rows that still exist, most recently pinned first. */
        items,
        isPinned: (kind: PinKind, id: string) => pinnedKeys.value.has(pinKey(kind, id)),
        toggle,
    };
}
