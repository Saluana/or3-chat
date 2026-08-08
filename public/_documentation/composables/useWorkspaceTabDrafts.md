# useWorkspaceTabDrafts

In-memory draft store for chat composers inside workspace tabs. It keeps unsent text, editor JSON, attachments, and composer settings alive while a user switches tabs, and never persists drafts to the manifest.

## Purpose

`useWorkspaceTabDrafts()` returns:

-   `read(tabId)` — read a tab's draft (clears its discard timer).
-   `write(tabId, draft)` — save a draft.
-   `discard(tabId)` — remove a draft and revoke its blob URLs.
-   `discardAfter(tabId, delayMs?)` — remove a draft after a delay (default 6s). Used to keep a closed tab's composer alive long enough for Undo.
-   `clear()` — discard every draft.

## Draft shape

```ts
interface WorkspaceChatTabDraft {
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
```

## Usage

```ts
const drafts = useWorkspaceTabDrafts();

// Save when the composer changes:
drafts.write(tabId, {
    version: 1,
    text: composerText.value,
    attachments: attachments.value,
    largeTextBlocks: [],
    updatedAt: Date.now(),
});

// Restore when the tab becomes active:
const draft = drafts.read(tabId);
```

## Notes

-   Blob URLs for attachments are revoked when a draft is discarded.
-   Drafts are intentionally session-only; a reload loses them.

## Related

-   `useWorkspaceTabs` — the tab session that coordinates drafts.
-   `useWorkspaceTabPersistence` — persists the tab manifest, not drafts.
