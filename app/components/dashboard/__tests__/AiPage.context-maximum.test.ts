import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { defineComponent, nextTick } from 'vue';
import Dexie from 'dexie';
import { getDb, getWorkspaceDb, setActiveWorkspaceDb, evictWorkspaceDb } from '~/db/client';
import { getKvByName, setKvByName } from '~/db/kv';
import { setHookEngine, useHooks } from '~/core/hooks/useHooks';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import { DEFAULT_AI_SETTINGS, useAiSettings } from '~/composables/chat/useAiSettings';
import { MODELS_CACHE_KEY, useModelStore } from '~/composables/chat/useModelStore';

vi.mock('~~/shared/openrouter', async (original) => ({
    ...await original<typeof import('~~/shared/openrouter')>(),
    createOpenRouterClient: () => ({ models: { list: async () => ({
        async *[Symbol.asyncIterator]() { yield { result: { data: [] } }; },
    }) } }),
}));
import AiPage from '../AiPage.vue';

// The shared test setup replaces UInput with a div. This adapter preserves
// the native input/update contract; settings and persistence remain real.
const Input = defineComponent({
    props: ['modelValue'], emits: ['update:modelValue'],
    template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
});
let wrapper: VueWrapper | undefined;
let workspace: string;
let dispose: (() => void) | undefined;
const otherWorkspaces = new Set<string>();
const input = () => wrapper!.get<HTMLInputElement>('#dashboard-ai-max-context-input');
async function savedMaximum() {
    return JSON.parse((await getKvByName('ai_settings'))!.value!).maxContextTokens;
}
async function openPage() {
    wrapper = mount(AiPage, { global: { stubs: {
        UInput: Input, UTextarea: { template: '<textarea />' },
        ChatModelVariantSelect: { template: '<select />' },
    } } });
    await nextTick();
    await useModelStore().fetchModels();
    await vi.waitFor(async () => expect(await getKvByName(MODELS_CACHE_KEY)).toBeTruthy());
    return wrapper;
}
async function save(value: string) {
    await input().setValue(value);
    await wrapper!.get('#dashboard-ai-save-context-btn').trigger('click');
}
beforeEach(async () => {
    workspace = `dashboard-context-${crypto.randomUUID()}`;
    setHookEngine(createTypedHookEngine(createHookEngine()));
    await setActiveWorkspaceDb(workspace).open();
    localStorage.clear();
    await useModelStore().invalidate();
    await useAiSettings().ensureLoaded();
});
afterEach(async () => {
    wrapper?.unmount(); wrapper = undefined;
    dispose?.(); dispose = undefined;
    vi.restoreAllMocks();
    const names = [workspace, ...otherWorkspaces].map((id) => [id, getWorkspaceDb(id).name] as const);
    setActiveWorkspaceDb(null);
    for (const [id, name] of names) { evictWorkspaceDb(id); await Dexie.delete(name); }
    otherWorkspaces.clear();
    setHookEngine(null);
});

// Native admission consumes this workspace setting; retain its real KV owner.
describe('Dashboard context maximum through real KV', () => {
    it('exposes the optional maximum and retains existing controls', async () => {
        await openPage();
        expect(wrapper!.get('#dashboard-ai-context-section').isVisible()).toBe(true);
        expect(input().element.value).toBe('');
        expect(input().attributes('placeholder')).toBe('Use model limit');
        expect(wrapper!.get('label[for="dashboard-ai-max-context-input"]').text()).toBe('Maximum context tokens');
        expect(wrapper!.find('#dashboard-ai-master-textarea').exists()).toBe(true);
        expect(wrapper!.find('#dashboard-ai-model-last-selected-btn').exists()).toBe(true);
    });

    it('persists a large maximum across reload and keeps it when the default model changes', async () => {
        await openPage();
        await save('2000000');
        await vi.waitFor(async () => expect(await savedMaximum()).toBe(2_000_000));
        await useAiSettings().set({ fixedModelId: 'small-window/model', defaultModelMode: 'fixed' });
        expect(await savedMaximum()).toBe(2_000_000);
        wrapper!.unmount();
        await openPage();
        expect(input().element.value).toBe('2000000');
    });

    it('saves blank as model limit and full reset restores null', async () => {
        await useAiSettings().set({ maxContextTokens: 100_000 });
        await openPage();
        await save('');
        await vi.waitFor(async () => expect(await savedMaximum()).toBeNull());
        await save('250000');
        await vi.waitFor(async () => expect(await savedMaximum()).toBe(250_000));
        await wrapper!.get('#dashboard-ai-reset-btn').trigger('click');
        await vi.waitFor(async () => expect(await savedMaximum()).toBeNull());
        expect(input().element.value).toBe('');
    });

    it('clears an unsaved maximum on Reset when the stored maximum is already null', async () => {
        await openPage();
        expect(useAiSettings().settings.value.maxContextTokens).toBeNull();
        await input().setValue('250000');
        await wrapper!.get('#dashboard-ai-reset-btn').trigger('click');
        await vi.waitFor(async () => expect(await savedMaximum()).toBeNull());
        await nextTick();
        expect(input().element.value).toBe('');
    });

    it('announces a failed visible Reset and allows retry without exposing the dormant maximum', async () => {
        await useAiSettings().set({ maxContextTokens: 175_000, masterSystemPrompt: 'Keep this prompt' });
        await openPage();
        const failure = vi.spyOn(getDb().kv, 'put').mockRejectedValueOnce(new Error('Scripted Reset write failure'));
        await wrapper!.get('#dashboard-ai-reset-btn').trigger('click');
        await vi.waitFor(() => {
            const alert = wrapper!.get('#dashboard-ai-reset-section [role="alert"]');
            expect(alert.isVisible()).toBe(true);
            expect(alert.text()).toMatch(/could not reset.*retry/i);
        });
        expect(failure).toHaveBeenCalled();
        expect(await savedMaximum()).toBe(175_000);
        expect(wrapper!.get('#dashboard-ai-context-section').isVisible()).toBe(true);
        expect(wrapper!.get('#dashboard-ai-reset-btn').attributes('disabled')).toBeUndefined();
        failure.mockRestore();
        await wrapper!.get('#dashboard-ai-reset-btn').trigger('click');
        await vi.waitFor(async () => expect(await savedMaximum()).toBeNull());
        expect(wrapper!.find('#dashboard-ai-reset-section [role="alert"]').exists()).toBe(false);
        expect(useAiSettings().settings.value.masterSystemPrompt).toBe('');
    });

    it('shows accessible validation and preserves the saved value for invalid input', async () => {
        await useAiSettings().set({ maxContextTokens: 175_000 });
        await openPage();
        for (const invalid of ['0', '-1', '1.5', 'Infinity', 'NaN', '9007199254740992', 'words']) {
            await save(invalid);
            expect(input().attributes('aria-invalid')).toBe('true');
            expect(input().attributes('aria-describedby')).toContain('ai-max-context-error');
            expect(wrapper!.get('#ai-max-context-error').attributes('role')).toBe('alert');
            expect(wrapper!.get('#ai-max-context-error').text()).toMatch(/positive.*integer/i);
            expect(await savedMaximum()).toBe(175_000);
        }
    });

    it('keeps legacy preferences unset', async () => {
        const other = `dashboard-legacy-${crypto.randomUUID()}`; otherWorkspaces.add(other);
        const db = getWorkspaceDb(other);
        await setKvByName('ai_settings', JSON.stringify({ version: 1, masterSystemPrompt: 'Legacy prompt' }), db);
        setActiveWorkspaceDb(other);
        await useAiSettings().ensureLoaded();
        await openPage();
        expect(input().element.value).toBe('');
        expect(input().attributes('placeholder')).toBe('Use model limit');
    });

    it('reloads the active workspace and drops another workspace unsaved input/error', async () => {
        await useAiSettings().set({ maxContextTokens: 100_000 });
        await openPage(); await save('0');
        const other = `dashboard-other-${crypto.randomUUID()}`; otherWorkspaces.add(other);
        await setKvByName('ai_settings', JSON.stringify({ ...DEFAULT_AI_SETTINGS, maxContextTokens: 900_000 }), getWorkspaceDb(other));
        setActiveWorkspaceDb(other);
        await vi.waitFor(() => expect(input().element.value).toBe('900000'));
        expect(wrapper!.find('#ai-max-context-error').exists()).toBe(false);
        expect(await savedMaximum()).toBe(900_000);
    });

    it('reports an actual failed KV write and leaves the value editable for retry', async () => {
        await useAiSettings().set({ maxContextTokens: 100_000 });
        await openPage();
        const failure = vi.spyOn(getDb().kv, 'put').mockRejectedValueOnce(new Error('Scripted preferences write failure'));
        await save('250000');
        await vi.waitFor(() => expect(wrapper!.get('#ai-max-context-error').text()).toMatch(/save|retry/i));
        expect(failure).toHaveBeenCalled();
        expect(input().element.value).toBe('250000');
        expect(await savedMaximum()).toBe(100_000);
        failure.mockRestore();
        await wrapper!.get('#dashboard-ai-save-context-btn').trigger('click');
        await vi.waitFor(async () => expect(await savedMaximum()).toBe(250_000));
        expect(wrapper!.find('#ai-max-context-error').exists()).toBe(false);
    });

    it('does not show a stale save error after switching workspaces during persistence', async () => {
        await useAiSettings().set({ maxContextTokens: 100_000 });
        await openPage();
        let release!: () => void; let entered!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const started = new Promise<void>((resolve) => { entered = resolve; });
        const hooks = useHooks();
        const hold: Parameters<typeof hooks.addFilter<'db.kv.upsertByName:filter:input'>>[1] = async (row) => {
            if (row.name === 'ai_settings' && typeof row.value === 'string' && row.value.includes('250000')) { entered(); await gate; }
            return row;
        };
        hooks.addFilter('db.kv.upsertByName:filter:input', hold);
        dispose = () => hooks.removeFilter('db.kv.upsertByName:filter:input', hold);
        const other = `dashboard-pending-${crypto.randomUUID()}`; otherWorkspaces.add(other);
        try {
            await setKvByName('ai_settings', JSON.stringify({ ...DEFAULT_AI_SETTINGS, maxContextTokens: 900_000 }), getWorkspaceDb(other));
            await save('250000'); await started;
            setActiveWorkspaceDb(other);
            await vi.waitFor(() => expect(input().element.value).toBe('900000'));
            release();
            await flushPromises();
            expect(wrapper!.get('#dashboard-ai-save-context-btn').text()).not.toContain('Saving');
            expect(wrapper!.find('#ai-max-context-error').exists()).toBe(false);
            expect(await savedMaximum()).toBe(900_000);
        } finally { release(); }
    });
});
