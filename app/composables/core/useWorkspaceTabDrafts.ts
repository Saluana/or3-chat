import type {
    ImageSettings,
    LargeTextBlock,
    UploadedImage,
} from '~/components/chat/chat-input/types';

export interface WorkspaceChatTabDraft {
    version: 1;
    text: string;
    editorJson?: Record<string, unknown>;
    attachments: UploadedImage[];
    largeTextBlocks: LargeTextBlock[];
    composer?: {
        model: string;
        webSearchEnabled: boolean;
        thinkingEnabled: boolean;
        reasoningEffort?: string;
        imageSettings: ImageSettings;
    };
    updatedAt: number;
}

const drafts = new Map<string, WorkspaceChatTabDraft>();
const discardTimers = new Map<string, ReturnType<typeof setTimeout>>();

function releaseDraftAttachments(draft: WorkspaceChatTabDraft | undefined): void {
    if (!draft) return;
    const released = new Set<string>();
    for (const attachment of draft.attachments) {
        const url = attachment.url;
        if (!url || !url.startsWith('blob:') || released.has(url)) continue;
        released.add(url);
        try {
            URL.revokeObjectURL(url);
        } catch {
            // Browser lifecycle teardown can already have released the URL.
        }
    }
}

function clearDiscardTimer(tabId: string): void {
    const timer = discardTimers.get(tabId);
    if (timer) clearTimeout(timer);
    discardTimers.delete(tabId);
}

/** In-memory only: attachment blobs and unsent drafts never enter the manifest. */
export function useWorkspaceTabDrafts() {
    function read(tabId: string | undefined): WorkspaceChatTabDraft | undefined {
        if (!tabId) return undefined;
        clearDiscardTimer(tabId);
        return drafts.get(tabId);
    }

    function write(tabId: string | undefined, draft: WorkspaceChatTabDraft): void {
        if (!tabId) return;
        clearDiscardTimer(tabId);
        drafts.set(tabId, draft);
    }

    function discard(tabId: string | undefined): WorkspaceChatTabDraft | undefined {
        if (!tabId) return undefined;
        clearDiscardTimer(tabId);
        const draft = drafts.get(tabId);
        drafts.delete(tabId);
        releaseDraftAttachments(draft);
        return draft;
    }

    /** Keep a closed tab's in-memory composer alive only long enough for Undo. */
    function discardAfter(tabId: string | undefined, delayMs = 6_000): void {
        if (!tabId || !drafts.has(tabId)) return;
        clearDiscardTimer(tabId);
        discardTimers.set(
            tabId,
            setTimeout(() => discard(tabId), Math.max(0, delayMs))
        );
    }

    function clear(): void {
        for (const tabId of [...drafts.keys()]) discard(tabId);
    }

    return { read, write, discard, discardAfter, clear };
}
