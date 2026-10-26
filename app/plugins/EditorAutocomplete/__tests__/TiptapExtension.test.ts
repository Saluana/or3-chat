import { afterEach, describe, expect, it, vi } from 'vitest';
import { computed } from 'vue';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions/placeholder';
import { AutocompleteExtension } from '../TiptapExtension';
import AutocompleteState from '../state';
import { state as globalState } from '~/state/global';
import { testRuntimeConfig } from '~~/tests/setup';

const { openRouterStream, session } = vi.hoisted(() => ({
    openRouterStream: vi.fn(),
    session: { signedIn: false, connected: false },
}));

vi.mock('~/core/auth/useUserApiKey', () => ({ useUserApiKey: () => ({ apiKey: computed(() => globalState.value.openrouterKey), connected: computed(() => session.connected) }) }));
vi.mock('~/utils/chat/openrouterStream', () => ({ openRouterStream }));
vi.mock('~/composables/auth/useSessionContext', () => ({
    getCachedSessionContext: () => session.signedIn ? { user: { id: 'autocomplete-user' } } : null,
}));

let editor: Editor | undefined;

afterEach(() => {
    editor?.destroy();
    editor = undefined;
    vi.useRealTimers();
    vi.restoreAllMocks();
    openRouterStream.mockReset();
    globalState.value.openrouterKey = null;
    localStorage.removeItem('openrouter_api_key');
    session.signedIn = false; session.connected = false;
    testRuntimeConfig.value.public.ssrAuthEnabled = true;
    testRuntimeConfig.value.public.openRouter.hasInstanceKey = false;
    testRuntimeConfig.value.public.openRouter.requireUserKey = false;
});

function makeEditor() {
    const element = document.createElement('div');
    document.body.appendChild(element);
    editor = new Editor({
        element,
        extensions: [
            StarterKit,
            Placeholder.configure({ placeholder: 'Write something…' }),
            AutocompleteExtension,
        ],
        content: '<p>Earlier context</p><p></p>',
    });
    return editor;
}

describe('AutocompleteExtension decorations', () => {
    it.each(['already offline', 'brief disconnect during debounce'] as const)('pauses autocomplete for %s and resumes only on new online typing', async phase => {
        testRuntimeConfig.value.public.ssrAuthEnabled = false;
        globalState.value.openrouterKey = 'synthetic-key';
        AutocompleteState.value.isEnabled = true;
        const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(phase !== 'already offline');
        openRouterStream.mockImplementation(async function* () {
            yield { type: 'text', text: '<next_line> continuation</next_line>' };
        });
        const current = makeEditor();
        current.commands.setTextSelection(current.state.doc.content.size - 1);
        current.view.focus();
        current.commands.insertContent('A');
        if (phase === 'brief disconnect during debounce') {
            online.mockReturnValue(false);
            window.dispatchEvent(new Event('offline'));
            online.mockReturnValue(true);
            window.dispatchEvent(new Event('online'));
        }
        await new Promise(resolve => setTimeout(resolve, 750));
        expect(openRouterStream).not.toHaveBeenCalled();
        online.mockReturnValue(true);
        window.dispatchEvent(new Event('online'));
        current.commands.insertContent('B');
        await vi.waitFor(() => expect(openRouterStream).toHaveBeenCalledOnce());
        await vi.waitFor(() => expect(current.view.dom.querySelector('.autocomplete-suggestion')?.textContent).toContain('continuation'));
    });

    it.each(['completion', 'error'] as const)('aborts on disconnect and ignores a late %s after reconnect', async result => {
        testRuntimeConfig.value.public.ssrAuthEnabled = false;
        globalState.value.openrouterKey = 'synthetic-key';
        AutocompleteState.value.isEnabled = true;
        const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
        let finish!: () => void;
        let completed = false;
        const gate = new Promise<void>(resolve => { finish = resolve; });
        openRouterStream.mockImplementationOnce(async function* () {
            try {
                await gate;
                if (result === 'error') throw new TypeError('Failed to fetch');
                yield { type: 'text', text: '<next_line> obsolete</next_line>' };
            } finally { completed = true; }
        }).mockImplementationOnce(async function* () {
            yield { type: 'text', text: '<next_line> reconnected</next_line>' };
        });
        const current = makeEditor();
        current.commands.setTextSelection(current.state.doc.content.size - 1);
        current.view.focus();
        current.commands.insertContent('A');
        try {
            await vi.waitFor(() => expect(openRouterStream).toHaveBeenCalledOnce());
            const signal: AbortSignal = openRouterStream.mock.calls[0]![0].signal;
            online.mockReturnValue(false);
            window.dispatchEvent(new Event('offline'));
            expect(signal.aborted).toBe(true);
            online.mockReturnValue(true);
            window.dispatchEvent(new Event('online'));
            finish();
            await vi.waitFor(() => expect(completed).toBe(true));
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(current.view.dom.querySelector('.autocomplete-suggestion')).toBeNull();
            expect(errors).not.toHaveBeenCalled();
            current.commands.insertContent('B');
            await vi.waitFor(() => expect(current.view.dom.querySelector('.autocomplete-suggestion')?.textContent).toContain('reconnected'));
        } finally { finish(); }
    });

    it.each([
        { name: 'signed in without any key', signedIn: true, instanceKey: false, userKey: null, requiresUserKey: false, calls: 0 },
        { name: 'guest with only an instance key', signedIn: false, instanceKey: true, userKey: null, requiresUserKey: false, calls: 0 },
        { name: 'required user key missing', signedIn: true, instanceKey: true, userKey: null, requiresUserKey: true, calls: 0 },
        { name: 'signed in with an instance key', signedIn: true, instanceKey: true, userKey: null, requiresUserKey: false, calls: 1 },
        { name: 'Cloud account connected', signedIn: true, instanceKey: false, userKey: null, requiresUserKey: true, connected: true, calls: 1 },
        { name: 'user key available', signedIn: false, instanceKey: false, userKey: 'synthetic-key', requiresUserKey: false, calls: 1 },
    ])('requests suggestions only with usable credentials: $name', async ({ signedIn, instanceKey, userKey, requiresUserKey, calls, connected }) => {
        session.signedIn = signedIn; session.connected = connected === true;
        testRuntimeConfig.value.public.ssrAuthEnabled = userKey === null;
        testRuntimeConfig.value.public.openRouter.hasInstanceKey = instanceKey;
        testRuntimeConfig.value.public.openRouter.requireUserKey = requiresUserKey;
        globalState.value.openrouterKey = userKey;
        AutocompleteState.value.isEnabled = true;
        openRouterStream.mockImplementation(async function* () {
            yield { type: 'text', text: '<next_line> continuation</next_line>' };
        });
        const current = makeEditor();
        current.commands.setTextSelection(current.state.doc.content.size - 1);
        current.view.focus();
        current.commands.insertContent('A');
        await new Promise(resolve => setTimeout(resolve, 750));
        expect(openRouterStream).toHaveBeenCalledTimes(calls);
        if (calls) expect(current.view.dom.querySelector('.autocomplete-suggestion')).not.toBeNull();
    });

    it('does not request suggestions when saved or synced content is restored into a focused editor', async () => {
        globalState.value.openrouterKey = 'synthetic-key';
        AutocompleteState.value.isEnabled = true;
        openRouterStream.mockImplementation(async function* () {});
        const current = makeEditor();
        current.view.focus();
        current.commands.setContent('<p>Restored content</p>', { emitUpdate: false });
        current.commands.setTextSelection(current.state.doc.content.size - 1);
        await new Promise(resolve => setTimeout(resolve, 750));
        expect(openRouterStream).not.toHaveBeenCalled();
    });

    it('replaces the empty-node placeholder with one caret-anchored suggestion', () => {
        const current = makeEditor();
        current.commands.setTextSelection(current.state.doc.content.size - 1);
        (current.commands as unknown as { setSuggestion: (value: string) => boolean })
            .setSuggestion('A clean continuation');

        const activeNode = current.view.dom.querySelector('.has-autocomplete-suggestion');
        const suggestion = current.view.dom.querySelector('.autocomplete-suggestion');
        expect(activeNode?.classList.contains('is-empty')).toBe(true);
        expect(suggestion?.querySelector('.autocomplete-suggestion__text')?.textContent)
            .toBe('A clean continuation');
        expect(suggestion?.querySelector('.autocomplete-suggestion__hint')?.textContent)
            .toBe('Tab');
        expect(current.view.dom.querySelectorAll('.autocomplete-suggestion')).toHaveLength(1);
    });

    it('does not render autocomplete in the middle of a text block', () => {
        const current = makeEditor();
        current.commands.setTextSelection(4);
        (current.commands as unknown as { setSuggestion: (value: string) => boolean })
            .setSuggestion('should stay hidden');

        expect(current.view.dom.querySelector('.autocomplete-suggestion')).toBeNull();
        expect(current.view.dom.querySelector('.has-autocomplete-suggestion')).toBeNull();
    });

    it('does not resurrect a legacy localStorage key after logout', async () => {
        AutocompleteState.value.isEnabled = true;
        globalState.value.openrouterKey = null;
        localStorage.setItem('openrouter_api_key', 'legacy-key');

        const current = makeEditor();
        current.commands.setTextSelection(current.state.doc.content.size - 1);
        current.commands.insertContent('A');

        await new Promise((resolve) => setTimeout(resolve, 700));
        expect(openRouterStream).not.toHaveBeenCalled();
    });
});

it('times out a hung autocomplete and allows the next edit to request a suggestion', async () => {
    testRuntimeConfig.value.public.ssrAuthEnabled = false;
    globalState.value.openrouterKey = 'synthetic-key';
    AutocompleteState.value.isEnabled = true;
    openRouterStream.mockImplementationOnce(async function* () { await new Promise(() => {}); })
        .mockImplementationOnce(async function* () { yield { type: 'text', text: '<next_line> recovered</next_line>' }; });
    const current = makeEditor();
    current.view.focus();
    current.commands.setTextSelection(current.state.doc.content.size - 1);
    current.commands.insertContent('A');
    await vi.waitFor(() => expect(openRouterStream).toHaveBeenCalledTimes(1));
    expect(openRouterStream).toHaveBeenCalledTimes(1);
    const signal = openRouterStream.mock.calls[0]![0].signal;
    await vi.waitFor(() => expect(signal.aborted).toBe(true), { timeout: 6000 });
    expect(signal.aborted).toBe(true);
    current.commands.insertContent('B');
    await new Promise(resolve => setTimeout(resolve, 750));
    expect(openRouterStream).toHaveBeenCalledTimes(2);
    expect(current.view.dom.querySelector('.autocomplete-suggestion')?.textContent).toContain('recovered');
});
