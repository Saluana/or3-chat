import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h, nextTick, ref } from 'vue';
import { setActiveWorkspaceDb, evictWorkspaceDb } from '~/db/client';
import { useMessageThumbnails } from '~/composables/chat/useMessageThumbnails';
import { createMessageMediaPrefetchController } from '~/composables/chat/useMessageMediaPrefetch';
import MessageAttachmentsGallery from '../MessageAttachmentsGallery.vue';
import ChatMessage from '../ChatMessage.vue';
import PaletteImageThumb from '../../search/PaletteImageThumb.vue';

const files = vi.hoisted(() => ({ meta: vi.fn(), blob: vi.fn() }));
vi.mock('~/db/files', () => ({ getFileMeta: files.meta, getFileBlob: files.blob }));
const hash = `sha256:${'a'.repeat(64)}`;
const originMeta = { hash, kind: 'image', name: 'origin-synthetic-name.png', mime_type: 'image/png', width: 1, height: 1 };
const raster = () => new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: 'image/png' });
let wrappers: VueWrapper[] = [];
beforeEach(() => {
    setActiveWorkspaceDb('consumer-thumbnails-a');
    files.meta.mockReset().mockResolvedValue(originMeta);
    files.blob.mockReset().mockResolvedValue(raster());
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:consumer-origin'), revokeObjectURL: vi.fn() });
    vi.stubGlobal('Image', class { src = ''; decode = async () => undefined; });
    vi.stubGlobal('IntersectionObserver', undefined);
});
afterEach(() => {
    for (const wrapper of wrappers) wrapper.unmount();
    wrappers = [];
    setActiveWorkspaceDb(null);
    const shared = (globalThis as typeof globalThis & { __or3ThumbUrlCache?: {
        stopWorkspace?: () => void; cleanupTimers: Map<string, ReturnType<typeof setTimeout>>;
    } }).__or3ThumbUrlCache;
    shared?.stopWorkspace?.();
    shared?.cleanupTimers.forEach(clearTimeout);
    delete (globalThis as typeof globalThis & { __or3ThumbUrlCache?: unknown }).__or3ThumbUrlCache;
    evictWorkspaceDb('consumer-thumbnails-a');
    evictWorkspaceDb('consumer-thumbnails-b');
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});
function mountHook() {
    let state!: ReturnType<typeof useMessageThumbnails>;
    wrappers.push(mount(defineComponent({ setup() {
        state = useMessageThumbnails(ref({ file_hashes: [hash] }));
        return () => h('div');
    } })));
    return state;
}
describe('mounted thumbnail workspace consumers', () => {
    it('hydrates a streaming inline image when its thumbnail becomes ready during a quiet throttle window', async () => {
        vi.useFakeTimers();
        let ready!: (meta: typeof originMeta) => void;
        files.meta.mockImplementationOnce(() => new Promise(resolve => { ready = resolve; }));
        try {
            const wrapper = mount(ChatMessage, {
                props: { message: { id: 'quiet-image', role: 'assistant', pending: true,
                    text: `![file-hash:${hash}](data:image/gif;base64,R0lGODlhAQABAAAAACw=)`, file_hashes: [hash] } },
                global: { stubs: { ThreadChildLinks: true, ProjectMessageContext: true } },
            });
            wrappers.push(wrapper);
            await flushPromises();
            await vi.advanceTimersByTimeAsync(30);
            ready(originMeta);
            await flushPromises();
            await vi.advanceTimersByTimeAsync(300);
            const image = wrapper.get('img[alt^="file-hash:"]');
            expect(image.attributes('src')).toBe('blob:consumer-origin');
            expect(image.attributes('data-hydrated')).toBe('true');
        } finally {
            vi.useRealTimers();
        }
    });

    // Streaming replaces the message projection on every text frame. A slow
    // metadata read must not be reissued for unchanged attachment contents.
    it('keeps pending attachment reads stable across text updates and loads later hashes', async () => {
        let finish!: (meta: typeof originMeta) => void;
        files.meta.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        const message = ref<{ role: string; text: string; file_hashes: unknown }>({
            role: 'assistant', text: '', file_hashes: [hash],
        });
        let state!: ReturnType<typeof useMessageThumbnails>;
        wrappers.push(mount(defineComponent({ setup() {
            state = useMessageThumbnails(message);
            return () => h('div');
        } })));
        for (let index = 0; index < 30; index++) {
            message.value = { ...message.value, text: `Streamed text ${index}`,
                file_hashes: index % 2 ? JSON.stringify([hash]) : [hash] };
            await nextTick();
        }
        expect(files.meta).toHaveBeenCalledOnce();
        finish(originMeta);
        await vi.waitFor(() => expect(state.thumbnails[hash]?.status).toBe('ready'));

        // Foreground streaming appends through its raw array, then projects a
        // fresh message. Do not rely solely on reactive array mutation tracking.
        const streamedHashes = [hash];
        message.value.file_hashes = streamedHashes;
        await nextTick();
        const laterHash = `sha256:${'b'.repeat(64)}`;
        files.meta.mockResolvedValue({ ...originMeta, hash: laterHash });
        streamedHashes.push(laterHash);
        message.value = { ...message.value, text: 'A later generated image' };
        await vi.waitFor(() => expect(state.thumbnails[laterHash]?.status).toBe('ready'));
        expect(files.meta.mock.calls.map(call => call[0])).toEqual([hash, laterHash]);
        expect(files.blob.mock.calls.map(call => call[0])).toEqual([hash, laterHash]);
    });

    // A collapsed message must not spend bandwidth decoding hidden originals.
    // Existing workspace cases exercise one image and cannot catch this fan-out.
    it('loads only the four displayed image originals in a collapsed message', async () => {
        const hashes = Array.from({ length: 7 }, (_, index) => `sha256:${index.toString(16).padStart(64, '0')}`);
        wrappers.push(mount(defineComponent({ setup() {
            useMessageThumbnails(ref({ file_hashes: hashes }));
            return () => h('div');
        } })));
        await flushPromises();
        expect(files.meta.mock.calls.map(call => call[0])).toEqual(hashes.slice(0, 4));
        expect(files.blob.mock.calls.every(call => hashes.slice(0, 4).includes(call[0]))).toBe(true);
    });

    // Assistant inline images use this same cache, without the collapsed
    // attachment row's four-image limit.
    it('loads every assistant inline image beyond the fourth attachment', async () => {
        const hashes = Array.from({ length: 7 }, (_, index) => `sha256:${index.toString(16).padStart(64, '0')}`);
        let state!: ReturnType<typeof useMessageThumbnails>;
        wrappers.push(mount(defineComponent({ setup() {
            state = useMessageThumbnails(ref({ role: 'assistant', file_hashes: hashes }));
            return () => h('div');
        } })));
        await flushPromises();
        expect(files.meta.mock.calls.map(call => call[0])).toEqual(hashes);
        await vi.waitFor(() => expect(files.blob.mock.calls.map(call => call[0])).toEqual(hashes));
        await vi.waitFor(() => expect(state.thumbnails[hashes[6]!]?.status).toBe('ready'));
    });

    it.each(['palette-first', 'prefetch-first'] as const)('does not release a current palette retention when default prefetch resets (%s)', async order => {
        vi.mocked(URL.createObjectURL).mockReturnValueOnce('blob:prefetch-palette-origin').mockReturnValue('blob:prefetch-palette-target');
        const createPrefetch = () => createMessageMediaPrefetchController({
            loadMeta: async () => originMeta, loadBlob: async () => raster(),
        });
        let prefetch: ReturnType<typeof createPrefetch> | undefined = order === 'prefetch-first' ? createPrefetch() : undefined;
        const wrapper = mount(PaletteImageThumb, { props: { hash, alt: 'Synthetic retained palette image', fallbackIcon: 'image' } });
        wrappers.push(wrapper);
        prefetch ??= createPrefetch();
        prefetch.updateRange([{ file_hashes: [hash] }], { startIndex: 0, endIndex: 0 });
        await prefetch.whenIdle();
        await vi.waitFor(() => expect(wrapper.find('img').attributes('src')).toBe('blob:prefetch-palette-origin'));
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        try {
            setActiveWorkspaceDb('consumer-thumbnails-b');
            await vi.waitFor(() => expect(wrapper.find('img').attributes('src')).toBe('blob:prefetch-palette-target'));
            await vi.advanceTimersByTimeAsync(30_001);
            expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:prefetch-palette-target');
            expect(wrapper.find('img').attributes('src')).toBe('blob:prefetch-palette-target');
            wrapper.unmount();
            await vi.advanceTimersByTimeAsync(30_001);
            expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:prefetch-palette-target');
        } finally { prefetch.dispose(); wrapper.unmount(); vi.useRealTimers(); }
    });

    it.each(['changed', 'returned', 'unchanged'] as const)('keeps a shared palette thumbnail retained while a second consumer survives workspace %s', async transition => {
        vi.mocked(URL.createObjectURL).mockReturnValueOnce('blob:paired-origin').mockReturnValueOnce('blob:paired-target').mockReturnValue('blob:paired-return');
        const first = mount(PaletteImageThumb, { props: { hash, alt: 'First synthetic image', fallbackIcon: 'image' } });
        const second = mount(PaletteImageThumb, { props: { hash, alt: 'Second synthetic image', fallbackIcon: 'image' } });
        wrappers.push(first, second);
        await vi.waitFor(() => expect(first.find('img').attributes('src')).toBe('blob:paired-origin'));
        await vi.waitFor(() => expect(second.find('img').attributes('src')).toBe('blob:paired-origin'));
        let currentUrl = 'blob:paired-origin';
        if (transition !== 'unchanged') {
            setActiveWorkspaceDb('consumer-thumbnails-b');
            currentUrl = 'blob:paired-target';
            await vi.waitFor(() => expect(second.find('img').attributes('src')).toBe(currentUrl));
            if (transition === 'returned') {
                setActiveWorkspaceDb('consumer-thumbnails-a'); currentUrl = 'blob:paired-return';
                await vi.waitFor(() => expect(second.find('img').attributes('src')).toBe(currentUrl));
            }
        }
        await vi.waitFor(() => expect(first.find('img').attributes('src')).toBe(currentUrl));
        vi.useFakeTimers();
        try {
            first.unmount();
            await vi.advanceTimersByTimeAsync(15_001);
            expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(currentUrl);
            expect(second.find('img').attributes('src')).toBe(currentUrl);
            second.unmount();
            await vi.advanceTimersByTimeAsync(15_001);
            expect(URL.revokeObjectURL).toHaveBeenCalledWith(currentUrl);
        } finally { first.unmount(); second.unmount(); vi.useRealTimers(); }
    });

    it('clears an already displayed palette thumbnail on workspace switching', async () => {
        const wrapper = mount(PaletteImageThumb, { props: { hash, alt: 'Synthetic image', fallbackIcon: 'image' } });
        wrappers.push(wrapper);
        await vi.waitFor(() => expect(wrapper.find('img').exists()).toBe(true));
        files.meta.mockResolvedValue(undefined);
        setActiveWorkspaceDb('consumer-thumbnails-b');
        await flushPromises();
        expect(wrapper.find('img').exists()).toBe(false);
    });
    it.each(['gallery', 'hook'] as const)('clears settled former-workspace PDF names in the %s', async kind => {
        files.meta.mockResolvedValue({ ...originMeta, kind: 'pdf', mime_type: 'application/pdf', name: 'origin-synthetic-private.pdf' });
        const state = kind === 'hook' ? mountHook() : undefined;
        const wrapper = kind === 'gallery' ? mount(MessageAttachmentsGallery, { props: { hashes: [hash] } }) : undefined;
        if (wrapper) wrappers.push(wrapper);
        await flushPromises();
        if (state) expect(state.pdfMeta[hash]?.name).toBe('origin-synthetic-private.pdf');
        if (wrapper) expect(wrapper.text()).toContain('origin-synthetic-private.pdf');
        files.meta.mockResolvedValue(undefined);
        setActiveWorkspaceDb('consumer-thumbnails-b');
        await flushPromises();
        if (state) expect(state.pdfMeta[hash]).toBeUndefined();
        if (wrapper) expect(wrapper.text()).not.toContain('origin-synthetic-private.pdf');
    });
    it.each(['gallery', 'hook'] as const)('discards a held PDF metadata read in the %s after switching workspaces', async kind => {
        let finish!: (meta: typeof originMeta) => void;
        files.meta.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        const state = kind === 'hook' ? mountHook() : undefined;
        const wrapper = kind === 'gallery' ? mount(MessageAttachmentsGallery, { props: { hashes: [hash] } }) : undefined;
        if (wrapper) wrappers.push(wrapper);
        await vi.waitFor(() => expect(files.meta).toHaveBeenCalledOnce());
        setActiveWorkspaceDb('consumer-thumbnails-b');
        finish({ ...originMeta, kind: 'pdf', mime_type: 'application/pdf', name: 'origin-synthetic-private.pdf' });
        await flushPromises();
        if (state) expect(state.pdfMeta[hash]).toBeUndefined();
        if (wrapper) expect(wrapper.text()).not.toContain('origin-synthetic-private.pdf');
    });
    it.each(['gallery', 'hook', 'palette'] as const)('loads current-workspace data for unchanged hash identifiers in the %s', async kind => {
        vi.mocked(URL.createObjectURL).mockReturnValueOnce('blob:consumer-origin').mockReturnValue('blob:consumer-current');
        const state = kind === 'hook' ? mountHook() : undefined;
        const wrapper = kind === 'gallery'
            ? mount(MessageAttachmentsGallery, { props: { hashes: [hash] } })
            : kind === 'palette' ? mount(PaletteImageThumb, { props: { hash, alt: 'Synthetic image', fallbackIcon: 'image' } }) : undefined;
        if (wrapper) wrappers.push(wrapper);
        const displayedUrl = () => {
            const thumbnail = state?.thumbnails[hash];
            if (thumbnail?.status === 'ready') return thumbnail.url;
            return wrapper?.find('img').exists() ? wrapper.find('img').attributes('src') : undefined;
        };
        await vi.waitFor(() => expect(displayedUrl()).toBe('blob:consumer-origin'));
        files.meta.mockResolvedValue({ ...originMeta, name: 'current-valid.png', width: 2, height: 3 });
        setActiveWorkspaceDb('consumer-thumbnails-b');
        await vi.waitFor(() => expect(displayedUrl()).toBe('blob:consumer-current'));
        expect(files.blob).toHaveBeenCalledTimes(2);
        const thumbnail = state?.thumbnails[hash];
        if (thumbnail?.status === 'ready') expect(thumbnail).toMatchObject({ width: 2, height: 3 });
    });

    it.each(['gallery', 'hook', 'palette'] as const)('preserves recovered current-workspace thumbnails after former metadata fails in the %s', async kind => {
        let fail!: (error: Error) => void;
        files.meta.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
        vi.mocked(URL.createObjectURL).mockReturnValue('blob:consumer-recovered');
        const state = kind === 'hook' ? mountHook() : undefined;
        const wrapper = kind === 'gallery'
            ? mount(MessageAttachmentsGallery, { props: { hashes: [hash] } })
            : kind === 'palette' ? mount(PaletteImageThumb, { props: { hash, alt: 'Synthetic image', fallbackIcon: 'image' } }) : undefined;
        if (wrapper) wrappers.push(wrapper);
        const displayedUrl = () => {
            const thumbnail = state?.thumbnails[hash];
            if (thumbnail?.status === 'ready') return thumbnail.url;
            return wrapper?.find('img').exists() ? wrapper.find('img').attributes('src') : undefined;
        };
        await vi.waitFor(() => expect(files.meta).toHaveBeenCalledOnce());
        setActiveWorkspaceDb('consumer-thumbnails-b');
        await vi.waitFor(() => expect(displayedUrl()).toBe('blob:consumer-recovered'));
        fail(new Error('synthetic old metadata failure'));
        await flushPromises();
        expect(displayedUrl()).toBe('blob:consumer-recovered');
        expect(files.blob).toHaveBeenCalledOnce();
    });

    it('discards a held chat attachment download after a workspace switch', async () => {
        files.meta.mockResolvedValue({ ...originMeta, kind: 'file', mime_type: 'text/plain' });
        const wrapper = mount(MessageAttachmentsGallery, { props: { hashes: [hash] } });
        wrappers.push(wrapper);
        await flushPromises();
        let finish!: (blob: Blob) => void;
        files.blob.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        await wrapper.get('.message-attachment-file-download').trigger('click');
        await vi.waitFor(() => expect(files.blob).toHaveBeenCalledOnce());
        setActiveWorkspaceDb('consumer-thumbnails-b');
        finish(new Blob(['origin synthetic attachment'], { type: 'text/plain' }));
        await flushPromises();
        expect(click).not.toHaveBeenCalled();
    });
});
