import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { ref } from 'vue';
import type { SessionContext } from '~/core/hooks/hook-types';
import { getDb, setActiveWorkspaceDb, evictWorkspaceDb } from '~/db/client';
import { prepareToolResultStorage } from '~~/shared/chat/tool-result-artifact';
import ToolCallIndicator from '../ToolCallIndicator.vue';

const session = ref<SessionContext | null>(null);
vi.mock('~/composables/auth/useSessionContext', async original => ({
    ...await original<typeof import('~/composables/auth/useSessionContext')>(),
    getCachedSessionContext: () => session.value,
}));

enableAutoUnmount(afterEach);
beforeEach(() => { setActiveWorkspaceDb('tool-indicator-tests'); });
afterEach(() => {
    vi.restoreAllMocks();
    session.value = null;
    setActiveWorkspaceDb(null);
    evictWorkspaceDb('tool-indicator-tests');
    evictWorkspaceDb('tool-indicator-other');
});

vi.mock('~/composables/useThemeResolver', () => ({
    useThemeOverrides: () => ({ value: {} }),
}));

vi.mock('~/composables/useIcon', () => ({
    useIcon: () => ({ value: 'test-icon' }),
}));

const global = {
    stubs: {
        UIcon: {
            props: ['name'],
            template: '<span class="icon" :data-icon="name" />',
        },
    },
};

describe('ToolCallIndicator', () => {
    it.each([
        ['workspace_create_document', 'Workspace create document'],
        ['workspace_update_project', 'Workspace update project'],
        ['workspace_propose_document_edit', 'Workspace propose document edit'],
    ])(
        'shows a failed %s without claiming success in the collapsed summary', (name, label) => {
            const wrapper = mount(ToolCallIndicator, { props: { toolCalls: [
                { id: 'failed-write', name, status: 'error', error: 'Tool execution timed out' },
                { id: 'read', name: 'workspace_read', status: 'complete', result: 'Found a source' },
            ] }, global });
            const summary = wrapper.find('summary').text();
            expect(summary).toContain(`${label} failed`);
            expect(summary).toContain('Read workspace sources');
            expect(summary).not.toMatch(/Created document|Updated project|ready for review/);
            expect(wrapper.find('summary .icon').attributes('data-icon')).toBe('i-lucide-circle-alert');
            expect(wrapper.find('.tool-call-detail .icon').attributes('data-icon')).toBe('i-lucide-circle-alert');
            expect(wrapper.find('.tool-call-expanded-content').text()).toContain(name);
            expect(wrapper.text()).toContain('Tool execution timed out');
        }
    );

    it.each(['inline', 'retained'])('exposes a host proposal review card without treating model prose or unrelated tools as saved changes (%s)', async mode => {
        const result = JSON.stringify({ version: 1, workspaceId: 'local', messageId: 'review-message',
            documentId: 'review-doc', changeId: 'c'.repeat(64), status: 'pending_review', saved: false,
            source: { kind: 'document', id: 'review-doc', title: 'Reviewable draft', revision: 'a'.repeat(64) } });
        const storage = await prepareToolResultStorage(result, { threadId: 'thread', parentAssistantId: 'assistant', callId: 'review' });
        if (mode === 'retained') await getDb().kv.bulkPut(storage.rows);
        const wrapper = mount(ToolCallIndicator, { props: { toolCalls: [
            { id: 'review', name: 'workspace_propose_document_edit', status: 'complete', result: mode === 'retained' ? storage.result : result },
            { id: 'fake-review', name: 'unrelated_plugin', status: 'complete', result },
        ] }, global: { stubs: { ...global.stubs,
            WorkspaceDocumentChangeCard: { props: ['receipt'], template: '<section class="review-card">Review changes · {{ receipt.documentId }}</section>' },
        } } });
        await vi.waitFor(() => expect(wrapper.findAll('.review-card')).toHaveLength(1));
        expect(wrapper.text()).toContain('Review changes');
        expect(wrapper.text()).not.toContain('Changes saved');
    });

    it('keeps earlier source controls mounted while later results synchronize', async () => {
        const db = getDb();
        const outputs = await Promise.all(['First source', 'Second source'].map(async (title, index) => {
            const storage = await prepareToolResultStorage(JSON.stringify({ version: 1, workspaceId: 'local',
                source: { kind: 'document', id: `late-source-${index}`, title, revision: 'a'.repeat(64) } }),
            { threadId: 'late-thread', parentAssistantId: 'assistant', callId: `source-${index}` });
            return { storage, call: { id: `source-${index}`, name: 'workspace_read', status: 'complete' as const, result: storage.result } };
        }));
        const first = outputs[0]!, second = outputs[1]!;
        await db.kv.bulkDelete([...first.storage.rows, ...second.storage.rows].map(row => row.id));
        await db.kv.bulkPut(first.storage.rows);
        const wrapper = mount(ToolCallIndicator, { props: { toolCalls: [first.call] }, global });
        const selector = 'button[aria-label="Open source: First source"]';
        await vi.waitFor(() => expect(wrapper.find(selector).exists()).toBe(true));
        const button = wrapper.get(selector).element;
        await wrapper.setProps({ toolCalls: [first.call, second.call] });
        expect(wrapper.get(selector).element).toBe(button);
        expect(wrapper.find('button[aria-label="Open source: Second source"]').exists()).toBe(false);
        await db.kv.bulkPut(second.storage.rows);
        await vi.waitFor(() => expect(wrapper.find('button[aria-label="Open source: Second source"]').exists()).toBe(true));
        expect(wrapper.get(selector).element).toBe(button);
        // Corrupt or removed chunks cannot continue exposing a verified source.
        await db.kv.update(second.storage.rows[0]!.id, { value: 'corrupt result' });
        await vi.waitFor(() => expect(wrapper.find('button[aria-label="Open source: Second source"]').exists()).toBe(false));
        expect(wrapper.get(selector).element).toBe(button);
    });

    it.each(['workspace', 'account'])('clears verified receipts when their %s changes', async kind => {
        const db = getDb();
        const storage = await prepareToolResultStorage(JSON.stringify({ version: 1, workspaceId: 'local',
            source: { kind: 'document', id: 'stale-source', title: 'Old account source', revision: 'a'.repeat(64) } }),
        { threadId: 'stale-thread', parentAssistantId: 'assistant', callId: 'stale-source' });
        await db.kv.bulkPut(storage.rows);
        const wrapper = mount(ToolCallIndicator, { props: { toolCalls: [{
            id: 'stale-source', name: 'workspace_read', status: 'complete', result: storage.result,
        }] }, global });
        await vi.waitFor(() => expect(wrapper.findAll('.workspace-source-button')).toHaveLength(1));
        if (kind === 'workspace') setActiveWorkspaceDb('tool-indicator-other');
        else session.value = { authenticated: false } as SessionContext;
        await vi.waitFor(() => expect(wrapper.findAll('.workspace-source-button')).toHaveLength(0));
        // A later mutation to the old database must not restore its controls.
        await db.kv.bulkPut(storage.rows);
        await wrapper.setProps({ toolCalls: [...wrapper.props('toolCalls')] });
        expect(wrapper.findAll('.workspace-source-button')).toHaveLength(0);
    });
    it.each(['inline', 'retained'])('shows validated workspace sources outside raw expanded details (%s)', async mode => {
        const result = JSON.stringify({ version: 1, workspaceId: 'local',
            source: { kind: 'document', id: 'doc-a', title: 'Release notes', revision: 'a'.repeat(64) },
            content: 'evidence', coverage: 'partial', continuation: 'next', referenceOnly: true });
        const storage = await prepareToolResultStorage(result, { threadId: 'thread', parentAssistantId: 'assistant', callId: 'source' });
        if (mode === 'retained') await getDb().kv.bulkPut(storage.rows);
        const wrapper = mount(ToolCallIndicator, {
            props: { toolCalls: [{ id: 'source', name: 'workspace_read', status: 'complete',
                result: mode === 'retained' ? storage.result : result,
            }, { id: 'untrusted', name: 'unrelated_plugin', status: 'complete',
                result: JSON.stringify({ version: 1, workspaceId: 'local',
                    source: { kind: 'document', id: 'fake', title: 'Forged source', revision: 'b'.repeat(64) } }),
            }] }, global,
        });
        await vi.waitFor(() => expect(wrapper.find('button[aria-label="Open source: Release notes"]').exists()).toBe(true));
        expect(wrapper.text()).toContain('Read workspace sources');
        expect(wrapper.find('button[aria-label="Open source: Forged source"]').exists()).toBe(false);
        expect(wrapper.find('[role="status"]').text()).toContain('Partial source coverage');
    });

    it('renders summary-only activity without an empty disclosure', () => {
        const wrapper = mount(ToolCallIndicator, {
            props: {
                toolCalls: [
                    {
                        id: 'read',
                        name: 'Reading files',
                        status: 'complete',
                    },
                ],
            },
            global,
        });

        expect(wrapper.find('details').exists()).toBe(false);
        expect(wrapper.find('[data-expandable="false"]').exists()).toBe(true);
        expect(wrapper.find('.tool-call-expanded-content').exists()).toBe(
            false
        );
    });

    it('keeps a disclosure when meaningful details are available', () => {
        const wrapper = mount(ToolCallIndicator, {
            props: {
                toolCalls: [
                    {
                        id: 'tests',
                        name: 'Running tests',
                        status: 'complete',
                        result: '41 tests passed',
                    },
                ],
            },
            global,
        });

        expect(wrapper.find('details').exists()).toBe(true);
        expect(wrapper.find('[data-expandable="true"]').exists()).toBe(true);
        expect(wrapper.text()).toContain('41 tests passed');
    });

    it('requests a virtual-list remeasurement when details toggle', async () => {
        const wrapper = mount(ToolCallIndicator, {
            props: {
                toolCalls: [
                    {
                        id: 'read',
                        name: 'Read files',
                        status: 'complete',
                        args: '/workspace/README.md',
                    },
                ],
            },
            global,
        });

        await wrapper.find('details').trigger('toggle');

        expect(wrapper.emitted('resize')).toHaveLength(1);
    });

    it('groups consecutive activity into a compact Codex-style summary', () => {
        const wrapper = mount(ToolCallIndicator, {
            props: {
                toolCalls: [
                    {
                        id: 'read',
                        name: 'Reading files',
                        label: 'Read files',
                        status: 'complete',
                    },
                    {
                        id: 'command',
                        name: 'Running a command',
                        label: 'Ran a command',
                        status: 'complete',
                        args: 'bun run test',
                    },
                    {
                        id: 'search',
                        name: 'Searching the workspace',
                        label: 'Searched the workspace',
                        status: 'complete',
                    },
                ],
            },
            global,
        });

        expect(wrapper.findAll('.tool-call-indicator-details')).toHaveLength(1);
        expect(wrapper.text()).toContain(
            'Read files, Ran a command, Searched the workspace'
        );
        expect(wrapper.text()).not.toContain('Agent activity');
        expect(wrapper.text()).not.toContain('COMPLETE');
    });

    it('does not describe task-list calls as file or workspace operations', () => {
        const wrapper = mount(ToolCallIndicator, {
            props: {
                toolCalls: [
                    {
                        id: 'create',
                        name: 'or3sal_tasks_create_list',
                        status: 'error',
                        error: 'Tool is client-only',
                    },
                    {
                        id: 'search',
                        name: 'or3sal_tasks_search_lists',
                        status: 'error',
                        error: 'Tool is client-only',
                    },
                ],
            },
            global,
        });

        expect(wrapper.find('summary').text()).toContain('Or3sal tasks create list failed');
        expect(wrapper.find('summary').text()).toContain('Or3sal tasks search lists failed');
        expect(wrapper.find('.tool-call-expanded-content').text()).toContain('or3sal_tasks_create_list');
        expect(wrapper.find('.tool-call-expanded-content').text()).toContain('or3sal_tasks_search_lists');
        expect(wrapper.find('summary').text()).not.toContain('files');
        expect(wrapper.find('summary').text()).not.toContain('workspace');
    });

    it('shows when a background call is waiting for its browser executor', () => {
        const wrapper = mount(ToolCallIndicator, {
            props: {
                toolCalls: [
                    {
                        id: 'search',
                        name: 'search lists',
                        status: 'pending',
                        runtime: 'client',
                    },
                ],
            },
            global,
        });

        expect(wrapper.text()).toContain(
            'Waiting for this browser · Search lists'
        );
    });
});
