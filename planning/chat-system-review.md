Chat system review notes

Overview
- ChatContainer.vue orchestrates VirtualMessageList for history, keeps a streaming tail from useChat(), and wires ChatInputDropper.vue (model pick, attachments, send/stop).
- useChat.ts handles Dexie persistence, thread creation, streaming via openRouterStream (tool-call loop, file hash merge), and exposes tailAssistant/streamState.
- ChatMessage.vue renders bubbles, inline reasoning/Markdown, and manages attachment thumbnails plus inline image hydration with shared caches/ref counts.
- ChatInputDropper.vue provides the TipTap input, drag/paste attachments (images/PDF, large text buckets), model selection, composer actions, and emits sends.

Bugs / functional gaps
- app/components/chat/ChatInputDropper.vue: stray double quote after `:thread-id="props.threadId"` in the system prompt modal slot (~lines 310-314) makes the template invalid and risks SSR hydration errors.
- app/components/chat/ChatContainer.vue: onEdited only updates `messages` (UI) while useChat builds requests from `rawMessages`; edited text isn’t reflected in subsequent prompts, so the model sees stale content after an edit.
- app/components/chat/ChatContainer.vue: send path allows mixed ready/pending attachments; pending files are dropped silently because ChatInputDropper clears its attachments after emit, so users can lose files that were still hashing.
- app/components/chat/ChatInputDropper.vue: triggerFileInput appends a hidden `<input type="file">` to document.body and never removes it or its listener on unmount; repeated mounts (multi-pane/HMR) leak DOM nodes and event handlers.
- app/components/chat/VirtualMessageList.vue: computeRange always returns 0..len-1, so reached-top/bottom events fire regardless of scroll position, breaking any lazy-load/pagination logic that relies on those signals.

Performance / memory
- app/core/auth/openrouter-build.ts: global dataUrlCache/__or3ImageDataUrlCache and inflight maps never evict; long sessions with many images/PDFs accumulate base64 strings indefinitely. Add an LRU/TTL or prune on thread unload.
- app/components/chat/ChatContainer.vue + useChat.ts: send payload includes data-URL files even when file_hashes are present; openrouter-build rehydrates from hashes anyway, so we’re duplicating large base64 blobs in memory/request. Prefer sending hashes once persistence finishes and skip data URLs.
- app/components/chat/ChatInputDropper.vue: attachment processing is sequential and always reads full files into data URLs (even PDFs up to 20MB) before hashing, which can block the UI and spike memory on multi-file drops; consider parallel hashing with object URLs for previews.

Status updates (fixed)
- Removed stray quote in ChatInputDropper modal markup.
- Synced inline edits into useChat’s in-memory history (rawMessages/messages/tail) so retries build from edited text.
- Block sending while attachments are still hashing and prefer hashes over data URLs when sending.
- Cleaned up hidden file input + blob preview URLs on unmount/remove; previews now use object URLs.
- VirtualMessageList now computes visible range from scroll position instead of always 0..N.
- Added LRU pruning to OR image data URL cache to cap growth.
