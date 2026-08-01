import { describe, expect, it, vi } from 'vitest';
import {
    captureDocumentEditor,
    ensureDocumentEditorLocalDurability,
    getDocumentEditorSession,
    hasActiveDocumentEditor,
    registerDocumentEditorSession,
    waitForDocumentEditorSession,
    type ActiveDocumentEditorSession,
} from '../useDocumentEditorSessions';

function makeSession(
    overrides: Partial<ActiveDocumentEditorSession> = {}
): ActiveDocumentEditorSession {
    return {
        documentId: 'doc-a',
        paneId: 'pane-a',
        tabId: 'tab-a',
        captureContent: vi.fn(),
        ensureLocalDurability: vi.fn().mockResolvedValue(undefined),
        captureViewState: vi.fn(() => ({
            version: 1 as const,
            documentId: 'doc-a',
            scrollTop: 0,
        })),
        restoreViewState: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}

describe('document editor sessions', () => {
    it('selects duplicate-document sessions by pane and tab', () => {
        const first = makeSession();
        const second = makeSession({ paneId: 'pane-b', tabId: 'tab-b' });
        const unregisterFirst = registerDocumentEditorSession(first);
        const unregisterSecond = registerDocumentEditorSession(second);

        try {
            expect(
                getDocumentEditorSession({ paneId: 'pane-a', tabId: 'tab-a' })
            ).toBe(first);
            expect(
                getDocumentEditorSession({ paneId: 'pane-b', tabId: 'tab-b' })
            ).toBe(second);
            expect(hasActiveDocumentEditor('doc-a')).toBe(true);
        } finally {
            unregisterFirst();
            unregisterSecond();
        }

        expect(hasActiveDocumentEditor('doc-a')).toBe(false);
    });

    it('captures modern sessions synchronously and awaits legacy captures', async () => {
        const modern = makeSession();
        let resolveLegacy!: () => void;
        const legacyCapture = vi.fn(
            () =>
                new Promise<void>((resolve) => {
                    resolveLegacy = resolve;
                })
        );
        const unregisterModern = registerDocumentEditorSession(modern);
        const unregisterLegacy = registerDocumentEditorSession('doc-a', {
            capture: legacyCapture,
        });

        try {
            const capture = captureDocumentEditor('doc-a');
            expect(modern.captureContent).toHaveBeenCalledOnce();
            expect(legacyCapture).toHaveBeenCalledOnce();

            let settled = false;
            void capture.then(() => {
                settled = true;
            });
            await Promise.resolve();
            expect(settled).toBe(false);

            resolveLegacy();
            await capture;
            expect(settled).toBe(true);
        } finally {
            unregisterModern();
            unregisterLegacy();
        }
    });

    it('flushes every active local session and surfaces failures', async () => {
        const failure = new Error('disk unavailable');
        const first = makeSession();
        const second = makeSession({
            paneId: 'pane-b',
            tabId: 'tab-b',
            ensureLocalDurability: vi.fn().mockRejectedValue(failure),
        });
        const unregisterFirst = registerDocumentEditorSession(first);
        const unregisterSecond = registerDocumentEditorSession(second);

        try {
            await expect(
                ensureDocumentEditorLocalDurability('doc-a')
            ).rejects.toBe(failure);
            expect(first.ensureLocalDurability).toHaveBeenCalledOnce();
            expect(second.ensureLocalDurability).toHaveBeenCalledOnce();
        } finally {
            unregisterFirst();
            unregisterSecond();
        }
    });

    it('does not let stale cleanup remove a replacement workspace session', () => {
        const stale = makeSession();
        const replacement = makeSession();
        const unregisterStale = registerDocumentEditorSession(stale);
        const unregisterReplacement = registerDocumentEditorSession(replacement);

        unregisterStale();
        expect(
            getDocumentEditorSession({ paneId: 'pane-a', tabId: 'tab-a' })
        ).toBe(replacement);

        unregisterReplacement();
        expect(
            getDocumentEditorSession({ paneId: 'pane-a', tabId: 'tab-a' })
        ).toBeUndefined();
    });

    it('waits for a lazy editor session to register', async () => {
        const pending = waitForDocumentEditorSession(
            { paneId: 'pane-lazy', tabId: 'tab-lazy' },
            100
        );
        const session = makeSession({ paneId: 'pane-lazy', tabId: 'tab-lazy' });
        const unregister = registerDocumentEditorSession(session);
        try {
            await expect(pending).resolves.toBe(session);
        } finally {
            unregister();
        }
    });
});
