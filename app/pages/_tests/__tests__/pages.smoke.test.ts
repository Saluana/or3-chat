import { mount } from '@vue/test-utils';
import { afterAll, beforeAll, describe, it, expect, vi } from 'vitest';
import { Suspense, defineComponent, h } from 'vue';

vi.mock('convex-vue', async () => {
    const { ref } = await import('vue');
    return {
        useConvexQuery: () => ({
            data: ref(null),
            isPending: ref(false),
            error: ref(null),
        }),
        useConvexMutation: () => ({
            mutate: vi.fn(async () => null),
        }),
        useConvexClient: () => ({
            setAuth: vi.fn(),
        }),
    };
});

vi.mock('~~/convex/_generated/api', () => ({
    api: {
        users: { me: {} },
        workspaces: { listMyWorkspaces: {}, create: {} },
        sync: { push: {}, pull: {} },
    },
}));

type AnyRow = Record<string, unknown>;

type MemoryCollection = {
    count: () => Promise<number>;
    toArray: () => Promise<AnyRow[]>;
    delete: () => Promise<number>;
    modify: (patch: AnyRow) => Promise<void>;
    limit: (n: number) => Pick<MemoryCollection, 'count' | 'toArray'>;
};

function createCollection(
    rows: Map<string, AnyRow>,
    predicate: (row: AnyRow) => boolean
): MemoryCollection {
    const matches = () => [...rows.values()].filter(predicate);
    return {
        async count() {
            return matches().length;
        },
        async toArray() {
            return matches();
        },
        async delete() {
            let deleted = 0;
            for (const [key, row] of rows) {
                if (predicate(row)) {
                    rows.delete(key);
                    deleted += 1;
                }
            }
            return deleted;
        },
        async modify(patch) {
            for (const [key, row] of rows) {
                if (!predicate(row)) continue;
                rows.set(key, { ...row, ...patch });
            }
        },
        limit(n) {
            return {
                count: async () => Math.min(matches().length, n),
                toArray: async () => matches().slice(0, n),
            };
        },
    };
}

type MemoryOrderBy = {
    reverse: () => MemoryOrderBy;
    limit: (n: number) => {
        toArray: () => Promise<AnyRow[]>;
        first: () => Promise<AnyRow | undefined>;
    };
    toArray: () => Promise<AnyRow[]>;
    first: () => Promise<AnyRow | undefined>;
};

type MemoryTable = {
    count: () => Promise<number>;
    clear: () => Promise<void>;
    toArray: () => Promise<AnyRow[]>;
    put: (row: AnyRow) => Promise<void>;
    add: (row: AnyRow) => Promise<string>;
    get: (id: string) => Promise<AnyRow | undefined>;
    delete: (id: string) => Promise<void>;
    update: (id: string, patch: AnyRow) => Promise<number>;
    where: (field: string) => { equals: (value: unknown) => MemoryCollection };
    filter: (fn: (row: AnyRow) => boolean) => { toArray: () => Promise<AnyRow[]> };
    limit: (n: number) => { toArray: () => Promise<AnyRow[]> };
    orderBy: (field: string) => MemoryOrderBy;
};

function createTable(pkField: string): MemoryTable {
    const rows = new Map<string, AnyRow>();

    const sortByField = (field: string, reverse: boolean): AnyRow[] => {
        const list = [...rows.values()];
        list.sort((a, b) => {
            const av = a[field];
            const bv = b[field];
            const an = typeof av === 'number' ? av : Number(av ?? 0);
            const bn = typeof bv === 'number' ? bv : Number(bv ?? 0);
            return reverse ? bn - an : an - bn;
        });
        return list;
    };

    const buildOrderBy = (field: string, reverse = false): MemoryOrderBy => ({
        reverse: () => buildOrderBy(field, true),
        limit: (n) => ({
            toArray: async () => sortByField(field, reverse).slice(0, n),
            first: async () => sortByField(field, reverse)[0],
        }),
        toArray: async () => sortByField(field, reverse),
        first: async () => sortByField(field, reverse)[0],
    });

    return {
        async count() {
            return rows.size;
        },
        async clear() {
            rows.clear();
        },
        async toArray() {
            return [...rows.values()];
        },
        async put(row) {
            const key = String(row[pkField] ?? '');
            rows.set(key, { ...row, [pkField]: key });
        },
        async add(row) {
            const key = String(
                row[pkField] ?? `row-${Math.random().toString(36).slice(2, 10)}`
            );
            rows.set(key, { ...row, [pkField]: key });
            return key;
        },
        async get(id) {
            return rows.get(String(id));
        },
        async delete(id) {
            rows.delete(String(id));
        },
        async update(id, patch) {
            const key = String(id);
            const existing = rows.get(key);
            if (!existing) return 0;
            rows.set(key, { ...existing, ...patch });
            return 1;
        },
        where(field) {
            return {
                equals(value) {
                    return createCollection(rows, (row) => row[field] === value);
                },
            };
        },
        filter(fn) {
            return {
                toArray: async () => [...rows.values()].filter(fn),
            };
        },
        limit(n) {
            return {
                toArray: async () => [...rows.values()].slice(0, n),
            };
        },
        orderBy(field) {
            return buildOrderBy(field, false);
        },
    };
}

type MemoryDb = {
    name: string;
    threads: MemoryTable;
    messages: MemoryTable;
    kv: MemoryTable;
    pending_ops: MemoryTable;
    tombstones: MemoryTable;
    file_meta: MemoryTable;
    file_blobs: MemoryTable;
    file_transfers: MemoryTable;
    notifications: MemoryTable;
    transaction: (
        _mode: string,
        _tables: unknown[],
        cb: () => Promise<unknown>
    ) => Promise<unknown>;
};

function createDb(name: string): MemoryDb {
    return {
        name,
        threads: createTable('id'),
        messages: createTable('id'),
        kv: createTable('id'),
        pending_ops: createTable('id'),
        tombstones: createTable('id'),
        file_meta: createTable('hash'),
        file_blobs: createTable('hash'),
        file_transfers: createTable('id'),
        notifications: createTable('id'),
        transaction: async (_mode, _tables, cb) => cb(),
    };
}

vi.mock('~/db/client', () => {
    const workspaceDbs = new Map<string, MemoryDb>();
    let activeWorkspaceId: string | null = null;
    const defaultDb = createDb('or3-db');
    let activeDb: MemoryDb = defaultDb;

    function getWorkspaceDb(workspaceId: string): MemoryDb {
        const existing = workspaceDbs.get(workspaceId);
        if (existing) return existing;
        const created = createDb(`or3-db-${workspaceId}`);
        workspaceDbs.set(workspaceId, created);
        return created;
    }

    return {
        getDb: () => activeDb,
        setActiveWorkspaceDb: (workspaceId: string | null) => {
            activeWorkspaceId = workspaceId;
            activeDb = workspaceId ? getWorkspaceDb(workspaceId) : defaultDb;
            return activeDb;
        },
        getActiveWorkspaceId: () => activeWorkspaceId,
        getWorkspaceDbCacheStats: () => ({
            size: workspaceDbs.size,
            max: 10,
            keys: [...workspaceDbs.keys()],
        }),
        createWorkspaceDb: (workspaceId: string) => getWorkspaceDb(workspaceId),
        Or3DB: class {},
    };
});

vi.mock('~/core/sync/hook-bridge', () => ({
    getHookBridge: () => ({ start: vi.fn(), stop: vi.fn() }),
}));

import TestAuth from '../_test-auth.vue';
import TestAuthE2e from '../_test-auth-e2e.vue';
import TestConvex from '../_test-convex.vue';
import TestFullStack from '../_test-full-stack.vue';
import TestOfflineResilience from '../_test-offline-resilience.vue';
import TestStorage from '../_test-storage.vue';
import TestSyncConflicts from '../_test-sync-conflicts.vue';
import TestSyncE2e from '../_test-sync-e2e.vue';
import TestSync from '../_test-sync.vue';
import TestWorkspaceSync from '../_test-workspace-sync.vue';
import UseAi from '../use-ai.vue';
import UseWorkflows from '../use-workflows.vue';

const StubNuxtLink = defineComponent({
    name: 'StubNuxtLink',
    props: { to: { type: [String, Object], default: '/' } },
    setup(_props, { slots }) {
        return () => h('a', slots.default ? slots.default() : '');
    },
});

const StubClientOnly = defineComponent({
    name: 'StubClientOnly',
    setup(_props, { slots }) {
        return () => h('div', slots.default ? slots.default() : '');
    },
});

const StubUButton = defineComponent({
    name: 'StubUButton',
    props: {
        loading: { type: Boolean, default: false },
        disabled: { type: Boolean, default: false },
    },
    setup(props, { slots }) {
        return () =>
            h(
                'button',
                { disabled: props.disabled || props.loading },
                slots.default ? slots.default() : ''
            );
    },
});

const StubUInput = defineComponent({
    name: 'StubUInput',
    inheritAttrs: false,
    props: {
        modelValue: { type: [String, Number], default: '' },
        type: { type: String, default: 'text' },
        placeholder: { type: String, default: '' },
        size: { type: String, default: '' },
    },
    emits: ['update:modelValue'],
    setup(props, { emit }) {
        return () =>
            h('input', {
                value: String(props.modelValue ?? ''),
                type: props.type,
                placeholder: props.placeholder,
                onInput: (event: Event) => {
                    const target = event.target as HTMLInputElement | null;
                    emit('update:modelValue', target?.value ?? '');
                },
            });
    },
});

const StubUCard = defineComponent({
    name: 'StubUCard',
    setup(_props, { slots }) {
        return () =>
            h('div', [
                slots.header ? h('header', slots.header()) : null,
                slots.default ? h('div', slots.default()) : null,
            ]);
    },
});

const StubUIcon = defineComponent({
    name: 'StubUIcon',
    props: { name: { type: String, default: '' } },
    setup() {
        return () => h('span');
    },
});

const globalStubs = {
    NuxtLink: StubNuxtLink,
    ClientOnly: StubClientOnly,
    UButton: StubUButton,
    UInput: StubUInput,
    UCard: StubUCard,
    UIcon: StubUIcon,
};

describe('app/pages/_tests smoke', () => {
    const originalWarn = console.warn;
    const originalInfo = console.info;

    beforeAll(() => {
        console.warn = (...args: unknown[]) => {
            const first = typeof args[0] === 'string' ? args[0] : '';
            if (first.includes('<Suspense> is an experimental feature')) return;
            originalWarn(...(args as any[]));
        };
        console.info = (...args: unknown[]) => {
            const first = typeof args[0] === 'string' ? args[0] : '';
            if (first.includes('<Suspense> is an experimental feature')) return;
            originalInfo(...(args as any[]));
        };
    });

    afterAll(() => {
        console.warn = originalWarn;
        console.info = originalInfo;
    });

    const cases: Array<{ label: string; component: any; expects: string }> = [
        { label: '_test-auth', component: TestAuth, expects: 'Auth Integration Test' },
        { label: '_test-auth-e2e', component: TestAuthE2e, expects: 'Auth Integration Test' },
        { label: '_test-convex', component: TestConvex, expects: 'Convex Integration Test' },
        { label: '_test-full-stack', component: TestFullStack, expects: 'Full-Stack Integration Test' },
        { label: '_test-offline-resilience', component: TestOfflineResilience, expects: 'Offline Resilience' },
        { label: '_test-storage', component: TestStorage, expects: 'Storage Layer Test' },
        { label: '_test-sync-conflicts', component: TestSyncConflicts, expects: 'Sync Conflict Debug' },
        { label: '_test-sync-e2e', component: TestSyncE2e, expects: 'Sync Layer E2E Harness' },
        { label: '_test-sync', component: TestSync, expects: 'Sync Layer Test' },
        { label: '_test-workspace-sync', component: TestWorkspaceSync, expects: 'Workspace Sync Test' },
        { label: 'use-ai', component: UseAi, expects: 'useChat Frontend Test Bench' },
        { label: 'use-workflows', component: UseWorkflows, expects: 'Workflow Test Bench' },
    ];

    for (const c of cases) {
        it(`renders ${c.label}`, async () => {
            const Host = defineComponent({
                name: `Host_${c.label}`,
                setup() {
                    return () =>
                        h(Suspense, null, {
                            default: () => h(c.component),
                        });
                },
            });

            const wrapper = mount(Host, {
                global: { stubs: globalStubs },
            });

            // Let Suspense resolve.
            await Promise.resolve();
            await Promise.resolve();
            await new Promise((resolve) => setTimeout(resolve, 0));

            expect(wrapper.text()).toContain(c.expects);
            wrapper.unmount();
        });
    }
});
