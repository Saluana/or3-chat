<template>
    <div ref="rootElement" v-theme="'document.editor'" class="document-editor-root" data-context="document" :inert="externalWrite">
        <div v-if="documentLoaded && (paneConflict || state.status === 'error' && (state.pendingTitle !== undefined || state.pendingContent !== undefined))" class="document-status-banner" role="alert">
            <p>{{ paneConflict ? 'This document changed in another pane. Save a local copy to preserve your edits and reload the saved version.' : 'Your changes have not been saved locally.' }}</p>
            <UButton color="neutral" variant="soft" label="Retry document save" :disabled="restoring" @click="retryLocalSave" />
            <UButton color="neutral" variant="soft" label="Save local copy and reload" :loading="restoring" @click="recoverLocalCopy" />
        </div>
        <div v-if="documentLoaded && checkpointError" class="document-status-banner" role="alert">
            <p>Saved version could not be created. Retry to save a history checkpoint.</p>
            <UButton color="neutral" variant="soft" label="Retry saved version" :loading="checkpointBusy" @click="retryAutomaticRevision" />
        </div>
        <div v-if="documentLoaded && tooLargeToSync" class="document-status-banner" role="status">
            <p>The saved document is too large to sync. It is preserved on this device. Download a copy or split it into smaller documents.</p>
            <UButton color="neutral" variant="soft" label="Download Markdown" @click="downloadMarkdown" />
        </div>
        <div v-if="exportError" class="document-status-banner" role="alert">{{ exportError }}</div>
        <div v-if="documentLoaded && imageIntakeFailed" class="document-status-banner" role="alert">
            Image could not be added. Try attaching it again.
        </div>
        <div v-if="documentLoaded && itemReadOnly" class="document-status-banner" role="status">
            <UIcon :name="icons.inspector" class="document-status-icon" aria-hidden="true" />
            <p>{{ availabilityMessage }}</p>
        </div>
        <div v-if="!documentLoaded" class="document-unavailable" role="status">
            <UIcon :name="icons.inspector" class="document-status-icon" aria-hidden="true" />
            <h2>{{ loadingDocument ? 'Loading document…' : availability === 'trashed' ? 'Document in Trash' : 'Document unavailable' }}</h2>
            <p>{{ loadingDocument ? 'Your saved content is loading.' : availabilityMessage }}</p>
            <UButton v-if="state.status === 'error' || loadError" color="neutral" variant="soft" label="Try again" @click="loadActiveDocument(documentId)" />
            <UButton v-if="state.status === 'error' || loadError" color="neutral" variant="soft" label="Download original document" @click="downloadOriginalDocument" />
        </div>
        <div v-if="recoveryMessage" class="document-status-banner" role="status">{{ recoveryMessage }}</div>
        <div v-if="restoreError" class="document-status-banner" role="alert">{{ restoreError }}</div>
        <template v-if="documentLoaded">
        <div
            v-theme="'document.toolbar'"
            class="editor-toolbar document-editor-toolbar"
            :class="{
                'editor-toolbar--compact': isCompactToolbar,
                'editor-toolbar--mobile': isMobile,
                'editor-toolbar--with-inspector': inspectorOpen && !isCompactToolbar,
            }"
            role="toolbar"
            :inert="editorLocked"
            aria-label="Document formatting"
        >
            <div class="toolbar-primary-rail">
                <USelect
                    v-if="!isCompactToolbar"
                    :model-value="activeBlock"
                    :items="blockTypeItems"
                    value-key="value"
                    label-key="label"
                    size="sm"
                    class="block-type-select"
                    :content="{ align: 'start', sideOffset: 6 }"
                    :ui="{
                        content: 'w-max! min-w-44!',
                        item: 'min-h-9 px-3',
                        itemLabel: 'whitespace-nowrap overflow-visible! text-clip!',
                    }"
                    aria-label="Text style"
                    @update:model-value="setBlockType"
                />
                <UDropdownMenu
                    v-else
                    :items="mobileHeadingMenuItems"
                    :content="{ align: 'start', sideOffset: 6 }"
                >
                    <UButton
                        v-theme="'document.toolbar'"
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        square
                        class="document-toolbar-button retro-document-toolbar-button heading-style-button"
                        :class="
                            activeBlock !== 'paragraph'
                                ? 'bg-primary/40'
                                : 'opacity-80 hover:opacity-100'
                        "
                        :aria-label="`Text style: ${mobileHeadingLabel}`"
                        :aria-pressed="activeBlock !== 'paragraph' ? 'true' : 'false'"
                        :title="`Text style: ${mobileHeadingLabel}`"
                    >
                        {{ mobileHeadingShortLabel }}
                    </UButton>
                </UDropdownMenu>
                <span v-if="!isCompactToolbar" class="toolbar-separator" />
                <ToolbarButton
                    v-for="button in visibleFormatButtons"
                    :key="button.id"
                    v-bind="button"
                    :active="button.active?.()"
                    @activate="runToolbarAction(button.run)"
                />
                <template v-if="!isCompactToolbar">
                    <span class="toolbar-separator toolbar-secondary" />
                    <ToolbarButton
                        v-for="button in insertButtons"
                        :key="button.id"
                        v-bind="button"
                        class="toolbar-secondary"
                        :active="button.active?.()"
                        @activate="runToolbarAction(button.run)"
                    />
                </template>
                <template v-else>
                    <span class="toolbar-separator" />
                    <ToolbarButton
                        v-for="button in compactQuickInsertButtons"
                        :key="button.id"
                        v-bind="button"
                        :active="button.active?.()"
                        @activate="runToolbarAction(button.run)"
                    />
                </template>
            </div>
            <div class="toolbar-trailing">
                <ToolbarButton
                    v-if="!isCompactToolbar"
                    :icon="icons.undo"
                    :label="`Undo (${shortcut('z')})`"
                    @activate="runToolbarAction(() => editor?.chain().focus().undo().run())"
                />
                <ToolbarButton
                    v-if="!isCompactToolbar"
                    :icon="icons.redo"
                    :label="`Redo (${shortcut('z', true)})`"
                    @activate="runToolbarAction(() => editor?.chain().focus().redo().run())"
                />
                <UDropdownMenu
                    v-model:open="overflowOpen"
                    :items="toolbarOverflowItems"
                    :content="{ align: 'end' }"
                >
                    <UButton
                        v-theme="'document.toolbar-more'"
                        :icon="icons.more"
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        square
                        class="more-button"
                        aria-label="More editor tools"
                        :aria-expanded="overflowOpen"
                    />
                </UDropdownMenu>
                <UButton
                    v-if="!isMobile"
                    v-theme="'document.find'"
                    :icon="icons.search"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    square
                    class="find-toggle-button"
                    aria-label="Find in document"
                    :aria-pressed="findOpen"
                    title="Find in document"
                    @click="findOpen = !findOpen"
                />
                <UButton
                    v-theme="'document.inspector-toggle'"
                    :icon="icons.inspector"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    square
                    class="inspector-toggle-button"
                    aria-label="Outline & info"
                    :aria-pressed="inspectorOpen"
                    title="Outline & info"
                    @click="toggleInspector()"
                />
            </div>
        </div>

        <div v-if="findOpen" v-theme="'document.find-bar'" class="find-bar" role="search">
            <UInput ref="findInput" v-model="findQuery" class="find-input" size="sm" placeholder="Find" aria-label="Find text" @keydown.enter.prevent="findNext" />
            <span>{{ findStatus }}</span>
            <UButton :icon="icons.previous" color="neutral" variant="ghost" size="sm" square aria-label="Previous match" @click="findPrevious" />
            <UButton :icon="icons.next" color="neutral" variant="ghost" size="sm" square aria-label="Next match" @click="findNext" />
            <UInput v-model="replaceQuery" :disabled="editorLocked" class="find-input" size="sm" placeholder="Replace" aria-label="Replacement text" />
            <UButton :disabled="editorLocked || !searchMatches.length" color="neutral" variant="soft" size="sm" label="Replace" @click="replaceCurrent" />
            <UButton :disabled="editorLocked || !searchMatches.length" color="neutral" variant="soft" size="sm" label="All" @click="replaceAll" />
            <UButton :icon="icons.close" color="neutral" variant="ghost" size="sm" square aria-label="Close find" @click="findOpen = false" />
        </div>

        <Transition name="table-toolbar">
            <DocumentTableToolbar
                v-if="tableActive && editor && !editorLocked"
                :editor="editor"
                :table-icon="icons.table"
                @deleted="editorStateVersion += 1"
            />
        </Transition>

        <div class="editor-layout">
            <main ref="editorScroll" class="editor-scroll" @mousedown="focusCanvas">
                <article v-theme="'document.canvas'" class="document-canvas">
                    <UTextarea :disabled="editorLocked" id="document-title" :model-value="titleDraft" name="document-title" class="document-title-field" :ui="{ base: 'max-lg:text-[length:inherit]!' }" :rows="1" :maxrows="3" autoresize variant="none" maxlength="300" placeholder="Untitled" aria-label="Document title" @update:model-value="onTitleInput" @keydown.enter="onTitleEnter" />
                    <p class="document-byline">
                        <span>{{ stats.words.toLocaleString() }} {{ stats.words === 1 ? 'word' : 'words' }}</span>
                        <span v-if="stats.readingMinutes">{{ stats.readingMinutes }} min read</span>
                    </p>

                    <EditorContent v-if="editor" :editor="editor" class="document-content or3-prose" :class="{ 'document-content--readonly': editorLocked }" />

                    <!-- TipTap detaches the menu element. Keep Vue's conditional on a stable parent. -->
                    <div v-if="editor && !editorLocked">
                        <BubbleMenu v-theme="'document.selection-menu'" :editor="editor" :should-show="shouldShowTextSelection" :options="{ placement: 'top' }" class="selection-menu">
                            <UButton :icon="icons.bold" color="neutral" variant="ghost" size="sm" square :class="{ active: editor.isActive('bold') }" aria-label="Bold" @click="runToolbarAction(() => editor?.chain().focus().toggleBold().run())" />
                            <UButton :icon="icons.italic" color="neutral" variant="ghost" size="sm" square :class="{ active: editor.isActive('italic') }" aria-label="Italic" @click="runToolbarAction(() => editor?.chain().focus().toggleItalic().run())" />
                            <UButton :icon="icons.underline" color="neutral" variant="ghost" size="sm" square :class="{ active: editor.isActive('underline') }" aria-label="Underline" @click="runToolbarAction(() => editor?.chain().focus().toggleUnderline().run())" />
                            <UButton :icon="icons.ai" color="primary" variant="ghost" size="sm" square aria-label="Edit selection with AI" @click="openAiForSelection" />
                        </BubbleMenu>
                    </div>

                    <div v-if="slashOpen" ref="slashMenu" v-theme="'document.insert-menu'" class="slash-menu" role="listbox" aria-label="Insert block">
                        <div class="slash-menu-header">
                            <div class="slash-menu-label">Insert</div>
                            <UButton :icon="icons.close" color="neutral" variant="ghost" size="xs" square aria-label="Close insert menu" @click="closeSlashMenu()" />
                        </div>
                        <UButton v-for="command in filteredSlashCommands" :key="command.id" color="neutral" variant="ghost" class="slash-command" role="option" @click="runSlashCommand(command)">
                            <span class="slash-command-icon"><UIcon :name="command.icon" /></span>
                            <span class="slash-command-copy"
                                ><strong>{{ command.label }}</strong
                                ><small>{{ command.description }}</small></span
                            >
                        </UButton>
                    </div>
                </article>

                <div class="ai-composer-dock" @focusin="aiComposerFocused = true" @focusout="onAiComposerFocusOut">
                    <Suspense>
                        <DocumentAiPanel
                            v-bind="aiPanelState"
                            :document-id="documentId"
                            :selection-available="selectionAvailable"
                            :selected-text="selectedText"
                            :plugin-actions="documentAiActions"
                            :focus-nonce="aiFocusNonce"
                            :autocomplete="autocompleteStatus"
                            @submit="runAi"
                            @estimate="estimateAi"
                            @accept="acceptAi"
                            @accept-hunk="acceptAiHunk"
                            @discard-hunk="ai.discardHunk"
                            @focus-hunk="ai.focusHunk"
                            @focus-next-hunk="ai.focusNextHunk(1)"
                            @focus-prev-hunk="ai.focusNextHunk(-1)"
                            @reject="ai.reject"
                            @abort="ai.abort"
                            @toggle-autocomplete="toggleAutocomplete"
                            @clear-selection="clearAiSelection"
                        />
                        <template #fallback><div class="ai-composer-loading">Loading document AI…</div></template>
                    </Suspense>
                </div>
            </main>

            <Transition name="inspector-backdrop">
                <div v-if="inspectorOpen" class="inspector-backdrop" @click="inspectorOpen = false" />
            </Transition>
            <div
                v-if="!inspectorDefaultApplied"
                class="document-inspector document-inspector-placeholder"
                aria-hidden="true"
            />
            <Transition
                name="document-inspector"
                :css="inspectorTransitionsReady"
                @after-leave="onInspectorClosed"
            >
                <DocumentInspector v-if="inspectorOpen" :editor="editor" :document-id="documentId" :create-checkpoint="createManualCheckpoint" :read-only="editorLocked" :restore-revision="onInspectorRestore" :outline="outline" :active-outline-id="activeOutlineId" :stats="stats" :saved-at="state.record?.updated_at" :plugin-panels="inspectorPanels" :initial-tab="inspectorTab" @update:active-tab="inspectorTab = $event" @close="inspectorOpen = false" @outline-select="onOutlineSelect" @restore="(revision) => void onInspectorRestore(revision).catch(() => {})" />
            </Transition>
        </div>

        <input ref="imageInput" hidden tabindex="-1" aria-hidden="true" type="file" accept="image/*" multiple @change="onImageInput" />

        <AppModal v-model:open="linkDialogOpen" title="Edit link" description="Add a safe web address to the selected text.">
            <template #default>
                <UFormField label="Link URL" :error="linkError">
                    <UInput v-model="linkHref" variant="modal" type="url" placeholder="https://example.com" class="w-full" autofocus @keydown.enter.prevent="applyLink" />
                </UFormField>
            </template>
            <template #footer>
                <div class="link-dialog-actions">
                    <UButton v-if="editor?.isActive('link')" color="error" variant="ghost" size="modal" label="Remove link" @click="removeLink" />
                    <span />
                    <UButton color="neutral" variant="ghost" size="modal" label="Cancel" @click="linkDialogOpen = false" />
                    <UButton color="primary" size="modal" label="Apply" @click="applyLink" />
                </div>
            </template>
        </AppModal>

        <AppModal v-model:open="tableDialogOpen" title="Insert table" description="Choose the starting size. You can add or remove rows and columns later.">
            <template #default>
                <div class="table-dialog-fields">
                    <UFormField label="Rows">
                        <UInput v-model.number="tableRows" variant="modal" type="number" inputmode="numeric" :min="1" :max="20" aria-label="Table rows" />
                    </UFormField>
                    <UFormField label="Columns">
                        <UInput v-model.number="tableColumns" variant="modal" type="number" inputmode="numeric" :min="1" :max="20" aria-label="Table columns" />
                    </UFormField>
                    <USwitch v-model="tableHeaderRow" label="Header row" class="table-header-switch" />
                    <p>Tables can start between 1 × 1 and 20 × 20.</p>
                </div>
            </template>
            <template #footer>
                <div class="table-dialog-actions">
                    <UButton color="neutral" variant="ghost" size="modal" label="Cancel" @click="tableDialogOpen = false" />
                    <UButton color="primary" size="modal" label="Insert table" @click="insertTable" />
                </div>
            </template>
        </AppModal>
        </template>
    </div>
</template>

<script setup lang="ts">
import { shouldLockDocumentAiEditor } from '~/composables/documents/documentAiLifecycle';
import AppModal from '~/components/ui/AppModal.vue';
import { formatShortcut, isApplePlatform } from '~/utils/keyboard-shortcuts';
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, toRef, watch } from 'vue';
import { onClickOutside } from '@vueuse/core';
import { getSchema, isTextSelection } from '@tiptap/core';
import type { BubbleMenuPluginProps } from '@tiptap/extension-bubble-menu';
import { downloadBlob } from '~/utils/download-blob';
import { MAX_SYNC_PAYLOAD_BYTES, sanitizePayloadForSync } from '~~/shared/sync/sanitize';
import { Editor, EditorContent, type JSONContent } from '@tiptap/vue-3';
import { Selection } from '@tiptap/pm/state';
import { BubbleMenu } from '@tiptap/vue-3/menus';
import { VIEW_ONLY_NOTICE, useViewOnlyAccess } from '~/composables/auth/useViewOnlyAccess';
import ToolbarButton from './ToolbarButton.vue';
import DocumentInspector from './DocumentInspector.vue';
import DocumentTableToolbar from './DocumentTableToolbar.vue';
import { useIcon } from '~/composables/useIcon';
import { useResponsiveState } from '~/composables/core/useResponsiveState';
import AutocompleteState from '~/plugins/EditorAutocomplete/state';
import { acceptCommittedDocument, flush, loadDocument, refreshDocument, retainDocumentEditor, saveDocumentRecoveryCopy, setDocumentContent, setDocumentEditorConflict, setDocumentTitle, useDocumentState } from '~/composables/documents/useDocumentsStore';
import { getDb, getWorkspaceGeneration, subscribeActiveWorkspaceDb } from '~/db/client';
import { getCachedSessionContext } from '~/composables/auth/useSessionContext';
import { liveQuery } from 'dexie';
import { isVisibleWorkspaceItem, workspaceItemMetadata } from '~~/shared/posts/workspace-item';
import {
    registerDocumentEditorSession,
    type DocumentEditorFocusedRegion,
    type DocumentEditorViewState,
} from '~/composables/documents/useDocumentEditorSessions';
import {
    useDocumentInsights,
    type DocumentOutlineItem,
} from '~/composables/documents/useDocumentInsights';
import {
    useDocumentAiAgent,
    type DocumentAiEstimateRequest,
    type DocumentAiSubmission,
} from '~/composables/documents/useDocumentAiAgent';
import {
    useDocumentAiActions,
    type DocumentAiScope,
} from '~/composables/editor/useDocumentAiActions';
import { useEditorInspectorPanels } from '~/composables/editor/useEditorInspectorPanels';
import {
    useEditorToolbarButtons,
    type EditorToolbarButton,
} from '~/composables/editor/useEditorToolbar';
import { useHooks } from '~/core/hooks/useHooks';
import { loadDocumentEditorExtensions } from '~/utils/documents/document-editor-schema';
import { DEFAULT_DOCUMENT_TITLE } from '~/db/documents';
import { createOrRefFile } from '~/db/files';
import { createDocumentRevision, type CompleteDocumentRevision } from '~/db/document-revisions';
import { parseNativeDocumentContent, validateDocumentContent } from '~/utils/documents/validate-document-content';
import type { TipTapDocument } from '~/types/database';
import { isAllowedDocumentHref } from '~/utils/documents/document-href';
import {
    DOCUMENT_BLOCK_TYPE_ITEMS,
    isDocumentCompactToolbar,
    isDocumentMobilePrimaryToolId,
    type DocumentToolbarItem,
} from '~/core/documents/editor-toolbar';

const props = defineProps<{
    documentId: string;
    paneId?: string;
    tabId?: string;
}>();
const emit = defineEmits<{ ready: [documentId: string] }>();
const DocumentAiPanel = defineAsyncComponent(() => import('./DocumentAiPanel.vue'));
const icons = reactive({
    search: useIcon('editor.search'),
    inspector: useIcon('editor.inspector'),
    outline: useIcon('editor.outline'),
    more: useIcon('editor.more'),
    close: useIcon('editor.close'),
    previous: useIcon('editor.previous'),
    next: useIcon('editor.next'),
    ai: useIcon('editor.ai'),
    plugin: useIcon('editor.plugin'),
    bold: useIcon('editor.format.bold'),
    italic: useIcon('editor.format.italic'),
    underline: useIcon('editor.format.underline'),
    strike: useIcon('editor.format.strike'),
    link: useIcon('editor.format.link'),
    quote: useIcon('editor.format.quote'),
    bulletList: useIcon('editor.format.bullet-list'),
    orderedList: useIcon('editor.format.ordered-list'),
    taskList: useIcon('editor.format.task-list'),
    text: useIcon('editor.insert.text'),
    heading1: useIcon('editor.insert.heading-1'),
    heading2: useIcon('editor.insert.heading-2'),
    heading3: useIcon('editor.insert.heading-3'),
    code: useIcon('editor.code'),
    codeBlock: useIcon('editor.insert.code-block'),
    divider: useIcon('editor.insert.divider'),
    table: useIcon('editor.insert.table'),
    image: useIcon('editor.insert.image'),
    undo: useIcon('editor.undo'),
    redo: useIcon('editor.redo'),
});
const documentId = toRef(props, 'documentId');
const hooks = useHooks();
const editor = shallowRef<Editor | null>(null);
const editorDb = shallowRef(getDb());
const imageIntakeFailed = ref(false);
const rootElement = ref<HTMLElement>();
const editorScroll = ref<HTMLElement>();
const state = computed(() => useDocumentState(props.documentId, editorDb.value));
const titleDraft = ref('');
let capturedTitle = '';
let capturedEditorDocument: Editor['state']['doc'] | undefined;
let documentOwnership: { id: string; db: ReturnType<typeof getDb>; release: () => Promise<void> } | undefined;
const paneConflict = ref(false);
const conflictKey = () => props.tabId ?? props.paneId ?? 'legacy';
const externalWrite = ref(false);
const capturedContent = ref<TipTapDocument>({
    type: 'doc',
    content: [{ type: 'paragraph' }],
});
const contentVersion = ref(0);
const editorStateVersion = ref(0);
const selectionAvailable = ref(false);
const selectedText = ref('');
const { isMobile, hydrated: responsiveHydrated } = useResponsiveState();
/** Pane/container width — drives compact toolbar independently of viewport. */
const paneWidthPx = ref(0);
const isCompactToolbar = computed(() =>
    isDocumentCompactToolbar(paneWidthPx.value, isMobile.value)
);
let paneResizeObserver: ResizeObserver | undefined;
const inspectorOpen = ref(false);
const inspectorTab = ref('outline');
const aiFocusNonce = ref(0);
const aiComposerFocused = ref(false);
const overflowOpen = ref(false);
const slashMenu = ref<HTMLElement>();
const imageInput = ref<HTMLInputElement>();
const findInput = ref<{ inputRef?: HTMLInputElement | null }>();
const findOpen = ref(false);
const findQuery = ref('');
const replaceQuery = ref('');
const findIndex = ref(-1);
const slashOpen = ref(false);
const slashQuery = ref('');
const slashDismissed = ref(false);
const linkDialogOpen = ref(false);
const linkHref = ref('');
const linkError = ref('');
const tableDialogOpen = ref(false);
const tableRows = ref(3);
const tableColumns = ref(3);
const tableHeaderRow = ref(true);
const restoring = ref(false);
const restoreError = ref('');
const recoveryMessage = ref('');
const loadError = ref('');
const exportError = ref('');
const tooLargeToSync = ref(false);
const checkpointError = ref(false);
const checkpointBusy = ref(false);
let revisionGeneration = 0;
let automaticRetryCount = 0;
let pendingAutomaticRevision: { origin: ReturnType<typeof revisionOrigin>; document: Editor['state']['doc']; title: string } | undefined;
let didUnmount = false;
let captureTimer: ReturnType<typeof setTimeout> | undefined;
let revisionTimer: ReturnType<typeof setTimeout> | undefined;
let unregisterSession: (() => void) | undefined;
let lastAutomaticRevisionAt = 0;
const inspectorDefaultApplied = ref(false);
const inspectorTransitionsReady = ref(false);
let suppressFindAutofocus = false;
let loadedDocumentId: string | undefined;
let loadGeneration = 0;
const documentLoaded = ref(false);
const loadingDocument = ref(true);
const availability = ref<'loading' | 'active' | 'trashed' | 'unavailable'>('loading');
const viewOnly = useViewOnlyAccess();
const itemReadOnly = computed(() => viewOnly.value || availability.value !== 'active' || !!loadError.value);
const availabilityMessage = computed(() => {
    if (viewOnly.value) return VIEW_ONLY_NOTICE;
    if (availability.value === 'trashed') return 'This document is read-only. Restore it from Files Trash to edit it.';
    if ((state.value.status === 'error' || loadError.value) && !documentLoaded.value) return 'This document could not be read. Its original content has been preserved. Download the original or try again.';
    return 'This document is unavailable in this workspace.';
});
let itemSubscription: { unsubscribe(): void } | undefined;
watch([documentId, editorDb], ([id, db]) => {
    itemSubscription?.unsubscribe();
    availability.value = 'loading';
    tooLargeToSync.value = false;
    itemSubscription = liveQuery(() => db.posts.get(id)).subscribe({ next: row => {
        if (didUnmount || editorDb.value !== db || props.documentId !== id) return;
        tooLargeToSync.value = !!row && new TextEncoder().encode(JSON.stringify(sanitizePayloadForSync('posts', row, 'put'))).byteLength > MAX_SYNC_PAYLOAD_BYTES;
        const previous = availability.value;
        availability.value = row?.postType === 'doc' && isVisibleWorkspaceItem(row) ? 'active'
            : row?.postType === 'doc' && !row.deleted && workspaceItemMetadata(row.meta)?.trashed_at != null ? 'trashed' : 'unavailable';
        if (availability.value === 'active' && (previous === 'trashed' || previous === 'unavailable')
            && !documentLoaded.value && state.value.status !== 'loading') {
            void loadActiveDocument(id);
        } else if (availability.value === 'active' && documentLoaded.value) {
            // Sync writes bypass document CRUD hooks. Refresh the shared record;
            // the store and syncCleanBuffers retain dirty buffers and baselines.
            void refreshDocument(id, db);
        }
        if (itemReadOnly.value) ai.abort();
    } });
}, { immediate: true });

const pluginButtons = useEditorToolbarButtons(editor);
const inspectorPanels = useEditorInspectorPanels();
const documentAiActions = useDocumentAiActions();
const { outline, activeOutlineId, stats, scrollTo, setSerializedSize, refresh } = useDocumentInsights(editor);

function captureContent(id = props.documentId, db = editorDb.value): void {
    // Capture edits made before the item became read-only; storage still refuses
    // writes to Trash, and the pending buffer must keep navigation blocked.
    if (db !== editorDb.value || loadedDocumentId !== id) return;
    const current = editor.value;
    if (!current || current.isDestroyed) return;
    if (captureTimer) clearTimeout(captureTimer);
    captureTimer = undefined;
    const currentState = useDocumentState(id, db);
    if (!currentState.record) return;
    const sharedTitle = currentState.pendingTitle ?? currentState.record.title;
    // ProseMirror documents are immutable. A title-only edit needs no body
    // serialization, schema normalization, or byte-size calculation.
    if (current.state.doc === capturedEditorDocument) {
        paneConflict.value = titleDraft.value !== capturedTitle && sharedTitle !== capturedTitle && titleDraft.value !== sharedTitle;
        setDocumentEditorConflict(id, conflictKey(), paneConflict.value
            ? { title: titleDraft.value, content: capturedContent.value,
                baselineTitle: capturedTitle, baselineContent: capturedContent.value }
            : undefined, db);
        if (paneConflict.value) return;
        if (titleDraft.value !== capturedTitle && titleDraft.value !== sharedTitle) setDocumentTitle(id, titleDraft.value, db);
        capturedTitle = titleDraft.value;
        return;
    }
    const json = current.getJSON();
    const serialized = JSON.stringify(json);
    const baseline = JSON.stringify(capturedContent.value);
    const sharedContent = JSON.stringify(current.schema.nodeFromJSON(normalizedContent(currentState.pendingContent !== undefined
        ? currentState.pendingContent : currentState.record.content)).toJSON());
    // Shared pending state is not permission for an independently edited pane
    // to rebase its old body/title over another pane's newer draft.
    paneConflict.value = (serialized !== baseline && sharedContent !== baseline && serialized !== sharedContent)
        || (titleDraft.value !== capturedTitle && sharedTitle !== capturedTitle && titleDraft.value !== sharedTitle);
    if (paneConflict.value) {
        setDocumentEditorConflict(id, conflictKey(), { title: titleDraft.value, content: json,
            baselineTitle: capturedTitle, baselineContent: capturedContent.value }, db);
        return;
    }
    setDocumentEditorConflict(id, conflictKey(), undefined, db);
    if (titleDraft.value !== capturedTitle && titleDraft.value !== sharedTitle) {
        setDocumentTitle(id, titleDraft.value, db);
    }
    capturedTitle = titleDraft.value;
    if (serialized !== baseline && serialized !== sharedContent) setDocumentContent(id, json, db);
    capturedContent.value = json;
    capturedEditorDocument = current.state.doc;
    setSerializedSize(new TextEncoder().encode(serialized).byteLength);
    syncCleanBuffers();
}

async function ensureLocalDurability(id = props.documentId, db = editorDb.value): Promise<void> {
    captureContent(id, db);
    if (paneConflict.value) throw new Error('This document changed in another pane. Your draft is retained; reconcile it before saving.');
    await flush(id, db);
    const currentState = useDocumentState(id, db);
    // A failed read is not a failed save. Only staged edits can block navigation.
    if (currentState.pendingTitle !== undefined || currentState.pendingContent !== undefined) {
        throw currentState.lastError instanceof Error
            ? currentState.lastError
            : new Error('Document could not be saved locally.');
    }
}

async function recoverLocalCopy() {
    if (restoring.value || externalWrite.value) return;
    const origin = revisionOrigin();
    const current = origin.current;
    if (!current || !origin.isCurrent()) return;
    captureContent(origin.id, origin.db);
    const document = current.state.doc;
    const title = titleDraft.value;
    const owner = paneConflict.value ? conflictKey() : undefined;
    const isCurrent = () => origin.isCurrent() && current.state.doc === document && titleDraft.value === title;
    restoring.value = true;
    recoveryMessage.value = '';
    try {
        const copy = await saveDocumentRecoveryCopy(origin.id, { title, content: document.toJSON() }, { conflictOwner: owner, isCurrent }, origin.db);
        if (!origin.isCurrent()) return;
        if (captureTimer) clearTimeout(captureTimer);
        captureTimer = undefined;
        ai.reset();
        if (owner) {
            if (!isCurrent()) return;
            paneConflict.value = false;
            await loadActiveDocument(origin.id);
        } else {
            // The shared store acknowledgement refreshes clean buffers. Do not
            // mistake that owned refresh for intervening user typing.
            await nextTick();
        }
        if (editorDb.value === origin.db && props.documentId === origin.id) recoveryMessage.value = `Your local edits were saved as “${copy.title}” in Files. The original has been reloaded.`;
    } catch (caught) {
        if (origin.isCurrent()) recoveryMessage.value = caught instanceof Error ? caught.message : 'The copy could not be saved. Your draft is still retained.';
    } finally {
        restoring.value = false;
    }
}

function retryLocalSave(): void {
    void ensureLocalDurability().catch((caught) => {
        console.error('[DocumentEditor] Local save failed', caught);
    });
}

function onBeforePageUnload(event: BeforeUnloadEvent): void {
    // Capture synchronously: the debounce may still hold the only copy. An
    // unload-time IndexedDB write alone is not a durability acknowledgement.
    captureContent();
    const currentState = useDocumentState(props.documentId, editorDb.value);
    if (!paneConflict.value && currentState.pendingTitle === undefined && currentState.pendingContent === undefined) return;
    event.preventDefault();
    event.returnValue = '';
    retryLocalSave();
}

function onDocumentVisibilityChange(): void {
    if (document.visibilityState === 'hidden') retryLocalSave();
}

const ai = useDocumentAiAgent({
    editor,
    documentId,
    title: titleDraft,
    contentVersion,
    persistCurrent: () => ensureLocalDurability(),
    readOnly: computed(() => itemReadOnly.value || externalWrite.value || restoring.value),
});

const editorLocked = computed(() => shouldLockDocumentAiEditor({
    readOnly: itemReadOnly.value || externalWrite.value || restoring.value, status: ai.status.value, accepting: ai.accepting.value,
}));
watch([editor, editorLocked], () => editor.value?.setEditable(!editorLocked.value, false), { flush: 'sync' });
const aiPanelState = computed(() => ({
    status: ai.status.value,
    readOnly: itemReadOnly.value || externalWrite.value || restoring.value,
    error: ai.error.value,
    tokenEstimate: ai.tokenEstimate.value,
    proposal: ai.proposal.value,
    stale: ai.stale.value,
    accepting: ai.accepting.value,
    agentStatus: ai.agentStatus.value,
    pendingHunkCount: ai.pendingHunkCount.value,
    focusedHunkId: ai.focusedHunkId.value,
}));
const autocompleteStatus = computed(() => ({
    enabled: AutocompleteState.value.isEnabled,
    loading: AutocompleteState.value.isLoading,
    error: AutocompleteState.value.lastError,
}));

onClickOutside(slashMenu, () => closeSlashMenu(false));

function emptyDocument(): TipTapDocument {
    return { type: 'doc', content: [{ type: 'paragraph' }] };
}

function normalizedContent(value: unknown): TipTapDocument {
    if (!value || typeof value !== 'object') return emptyDocument();
    const content = value as JSONContent;
    if (content.type !== 'doc' || (content.content !== undefined && !Array.isArray(content.content))) throw new Error('Invalid native document.');
    if (!content.content?.length) return { ...content, content: emptyDocument().content } as TipTapDocument;
    return content as TipTapDocument;
}

function scheduleCapture() {
    if (captureTimer) clearTimeout(captureTimer);
    captureTimer = setTimeout(() => {
        void ensureLocalDurability().catch((caught) => {
            console.error('[DocumentEditor] Scheduled save failed', caught);
        });
    }, 750);
}

function revisionOrigin() {
    const db = editorDb.value;
    const id = props.documentId;
    const current = editor.value;
    const generation = getWorkspaceGeneration();
    const account = getCachedSessionContext()?.user?.id;
    return { db, id, current, isCurrent: () => !didUnmount && editorDb.value === db && getDb() === db
        && props.documentId === id && editor.value === current && !current?.isDestroyed
        && getWorkspaceGeneration() === generation && getCachedSessionContext()?.user?.id === account };
}

async function saveAutomaticRevision(token: number) {
    const retained = pendingAutomaticRevision;
    const origin = retained?.origin ?? revisionOrigin();
    const { current, db, id } = origin;
    if (!current || !origin.isCurrent() || token !== revisionGeneration || itemReadOnly.value || externalWrite.value) return;
    const candidate = retained ?? { origin, document: current.state.doc, title: titleDraft.value };
    pendingAutomaticRevision = candidate;
    checkpointBusy.value = true;
    try {
        await ensureLocalDurability(id, db);
        if (!origin.isCurrent() || token !== revisionGeneration) return;
        if (!retained && (current.state.doc !== candidate.document || titleDraft.value !== candidate.title)) {
            pendingAutomaticRevision = undefined;
            scheduleAutomaticRevision();
            return;
        }
        await createDocumentRevision({ documentId: id, title: candidate.title, content: candidate.document.toJSON(), source: 'auto' }, db);
        if (!origin.isCurrent() || token !== revisionGeneration) return;
        pendingAutomaticRevision = undefined;
        checkpointError.value = false;
        automaticRetryCount = 0;
        lastAutomaticRevisionAt = Date.now();
        if (current.state.doc !== candidate.document || titleDraft.value !== candidate.title) scheduleAutomaticRevision();
    } catch {
        if (!origin.isCurrent() || token !== revisionGeneration) return;
        checkpointError.value = true;
        const delay = [5_000, 30_000, 60_000][automaticRetryCount++];
        if (delay !== undefined) revisionTimer = setTimeout(() => { revisionTimer = undefined; void saveAutomaticRevision(token); }, delay);
    } finally {
        if (origin.isCurrent() && token === revisionGeneration) checkpointBusy.value = false;
    }
}

function retryAutomaticRevision() {
    if (revisionTimer) clearTimeout(revisionTimer);
    automaticRetryCount = 0;
    void saveAutomaticRevision(++revisionGeneration);
}

function scheduleAutomaticRevision() {
    // Keep the failed immutable snapshot and its existing retry deadline while
    // typing continues. Only one owned recovery snapshot is retained.
    if (pendingAutomaticRevision && (checkpointBusy.value || revisionTimer !== undefined)) return;
    if (revisionTimer) clearTimeout(revisionTimer);
    const token = ++revisionGeneration;
    automaticRetryCount = 0;
    checkpointBusy.value = false;
    const fiveMinutes = 5 * 60 * 1000;
    const earliest = lastAutomaticRevisionAt ? Math.max(30_000, lastAutomaticRevisionAt + fiveMinutes - Date.now()) : 30_000;
    revisionTimer = setTimeout(() => { revisionTimer = undefined; void saveAutomaticRevision(token); }, earliest);
}

async function downloadOriginalDocument() {
    const origin = revisionOrigin();
    exportError.value = '';
    try {
        const row = await origin.db.posts.get(origin.id);
        if (!origin.isCurrent()) return;
        if (!row || row.postType !== 'doc' || !isVisibleWorkspaceItem(row)) throw new Error('Unavailable');
        downloadBlob(new Blob([row.content], { type: 'application/json' }), `${row.title || 'Document'}.json`);
    } catch {
        if (origin.isCurrent()) exportError.value = 'The original document could not be downloaded. Try again.';
    }
}

async function downloadMarkdown() {
    const origin = revisionOrigin();
    exportError.value = '';
    const current = origin.current;
    if (!current) return;
    const document = current.state.doc;
    const title = titleDraft.value;
    try {
        const { documentToMarkdown } = await import('~/utils/documents/document-to-markdown');
        const markdown = await documentToMarkdown(document.toJSON(), origin.db);
        if (!origin.isCurrent()) return;
        downloadBlob(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }), `${title || 'Document'}.md`);
    } catch {
        if (origin.isCurrent()) exportError.value = 'The document could not be exported completely. Check that its images are available and try again.';
    }
}

function updateSlashMenu() {
    const current = editor.value;
    if (!current) return;
    const { empty, $from } = current.state.selection;
    const parent = $from.parent;
    const text = parent.isTextblock ? parent.textContent : '';
    const match = empty && $from.parentOffset === parent.content.size
        ? /^\/([^\s]*)$/u.exec(text) : null;
    if (!match) slashDismissed.value = false;
    slashOpen.value = Boolean(match) && !slashDismissed.value;
    slashQuery.value = match?.[1]?.toLowerCase() ?? '';
}

function updateSelectionContext() {
    const current = editor.value;
    if (!current) return;
    const { from, to, empty } = current.state.selection;
    selectionAvailable.value = !empty;
    selectedText.value = empty ? '' : current.state.doc.textBetween(from, to, ' ', ' ').trim();
    // Refresh caret-relative scope chrome only while the composer has it active.
    ai.syncScopeHighlight(undefined, 'refresh');
}

function onEditorUpdate(payload?: { transaction?: { docChanged?: boolean } }) {
    if (itemReadOnly.value) return;
    // Ignore soft updates (e.g. TipTap setEditable) that do not change the doc.
    if (payload?.transaction && payload.transaction.docChanged === false) return;
    contentVersion.value += 1;
    editorStateVersion.value += 1;
    updateSelectionContext();
    scheduleCapture();
    scheduleAutomaticRevision();
    updateSlashMenu();
    hooks.doActionSync('editor.updated:action:after', { editor: editor.value });
}

async function insertFiles(files: File[]) {
    const current = editor.value;
    const db = editorDb.value;
    const id = props.documentId;
    const generation = getWorkspaceGeneration();
    const account = getCachedSessionContext()?.user?.id ?? null;
    const isCurrent = () => !didUnmount && current === editor.value && !!current &&
        !current.isDestroyed && current.isEditable && !itemReadOnly.value &&
        documentLoaded.value && loadedDocumentId === id && props.documentId === id &&
        editorDb.value === db && getDb() === db && getWorkspaceGeneration() === generation &&
        (getCachedSessionContext()?.user?.id ?? null) === account;
    if (!current || !isCurrent()) return;
    imageIntakeFailed.value = false;
    const owner = { assertCurrent() {
        if (!isCurrent()) throw new Error('Document editor changed while attaching image');
    } };
    for (const file of files.filter((item) => item.type.startsWith('image/'))) {
        try {
            owner.assertCurrent();
            const stored = await createOrRefFile(file, file.name || 'Document image', owner);
            owner.assertCurrent();
            current.chain().focus().insertContent({
                type: 'or3Image',
                attrs: { hash: stored.hash, alt: file.name.replace(/\.[^.]+$/u, ''), width: 100 },
            }).run();
        } catch {
            if (isCurrent()) imageIntakeFailed.value = true;
            return;
        }
    }
}

async function makeEditor(isCurrent: () => boolean) {
    const extensions = await loadDocumentEditorExtensions();
    if (!isCurrent()) return;
    const native = parseNativeDocumentContent(getSchema(extensions), capturedContent.value);
    editor.value?.destroy();
    editor.value = new Editor({
        extensions,
        content: native,
        autofocus: false,
        editorProps: {
            attributes: {
                role: 'textbox',
                'aria-label': 'Document body',
                'aria-multiline': 'true',
            },
            handlePaste: (_view, event) => {
                const files = [...(event.clipboardData?.files ?? [])];
                if (!files.some((file) => file.type.startsWith('image/'))) return false;
                void insertFiles(files);
                return true;
            },
            handleDrop: (_view, event) => {
                const files = [...(event.dataTransfer?.files ?? [])];
                if (!files.some((file) => file.type.startsWith('image/'))) return false;
                event.preventDefault();
                void insertFiles(files);
                return true;
            },
            handleKeyDown: (_view, event) => {
                if (event.key !== 'Escape') return false;
                if (slashOpen.value) {
                    closeSlashMenu();
                    return true;
                }
                if (overflowOpen.value) {
                    overflowOpen.value = false;
                    return true;
                }
                return false;
            },
        },
        onUpdate: onEditorUpdate,
        onSelectionUpdate: () => {
            editorStateVersion.value += 1;
            updateSelectionContext();
            refresh();
            updateSlashMenu();
        },
    });
    hooks.doActionSync('editor.created:action:after', { editor: editor.value });
    updateSelectionContext();
    refresh();
}

function focusedDocumentRegion(): DocumentEditorFocusedRegion | undefined {
    if (typeof document === 'undefined') return undefined;
    const active = document.activeElement;
    const root = rootElement.value;
    if (!(active instanceof HTMLElement) || !root?.contains(active)) {
        return undefined;
    }
    if (active.closest('.document-title-field')) return 'title';
    if (active.closest('.document-inspector')) return 'inspector';
    if (active.closest('.document-content')) return 'content';
    return undefined;
}

function contentRevisionFor(current: Editor): number {
    const serialized = JSON.stringify(current.getJSON());
    let hash = 2166136261;
    for (let index = 0; index < serialized.length; index += 1) {
        hash ^= serialized.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function captureDocumentViewState(id: string): DocumentEditorViewState {
    const current = editor.value;
    return {
        version: 1,
        documentId: id,
        contentRevision:
            current && !current.isDestroyed
                ? contentRevisionFor(current)
                : undefined,
        scrollTop: editorScroll.value?.scrollTop ?? 0,
        selectionJson:
            current && !current.isDestroyed
                ? current.state.selection.toJSON()
                : undefined,
        inspectorOpen: inspectorOpen.value,
        inspectorTab: inspectorTab.value,
        findOpen: findOpen.value,
        focusedRegion: focusedDocumentRegion(),
    };
}

function restoreEditorSelection(saved: DocumentEditorViewState): void {
    const current = editor.value;
    if (!current || current.isDestroyed || !saved.selectionJson) return;

    const currentRevision = contentRevisionFor(current);
    if (
        saved.contentRevision !== undefined &&
        saved.contentRevision !== currentRevision
    ) {
        return;
    }

    try {
        const selection = Selection.fromJSON(
            current.state.doc,
            saved.selectionJson
        );
        current.view.dispatch(current.state.tr.setSelection(selection));
    } catch {
        // The document changed or the saved selection is no longer legal.
        // Scroll/UI restoration remains useful and tab activation must continue.
    }
}

async function restoreDocumentViewState(
    id: string,
    saved: DocumentEditorViewState,
    options?: { focus?: boolean }
): Promise<void> {
    if (
        saved.version !== 1 ||
        saved.documentId !== id ||
        props.documentId !== id
    ) {
        return;
    }

    suppressFindAutofocus = true;
    inspectorTab.value = saved.inspectorTab ?? 'outline';
    // Narrow panes use a full-stage inspector — don't restore it open over the doc.
    inspectorOpen.value =
        Boolean(saved.inspectorOpen) && !isCompactToolbar.value;
    findOpen.value = Boolean(saved.findOpen);
    await nextTick();
    suppressFindAutofocus = false;

    if (props.documentId !== id) return;
    if (editorScroll.value) {
        editorScroll.value.scrollTop = Math.max(0, saved.scrollTop);
    }
    restoreEditorSelection(saved);
    if (!options?.focus || props.documentId !== id) return;

    if (saved.focusedRegion === 'title') {
        rootElement.value
            ?.querySelector<HTMLTextAreaElement>(
                '.document-title-field textarea'
            )
            ?.focus();
    } else if (saved.focusedRegion === 'inspector') {
        rootElement.value
            ?.querySelector<HTMLElement>(
                '.document-inspector button, .document-inspector [tabindex]'
            )
            ?.focus();
    } else {
        editor.value?.commands.focus();
    }
}

function registerActiveSession(id: string): void {
    unregisterSession?.();
    const db = editorDb.value;
    unregisterSession = registerDocumentEditorSession({
        documentId: id,
        originDb: db,
        paneId: props.paneId,
        tabId: props.tabId,
        captureContent: () => captureContent(id, db),
        ensureLocalDurability: () => ensureLocalDurability(id, db),
        captureViewState: () => captureDocumentViewState(id),
        restoreViewState: (saved, options) =>
            restoreDocumentViewState(id, saved, options),
        getChatContext: (requestId) => ai.getChatContext(requestId),
        getDocumentSnapshot: () => ({ title: titleDraft.value, content: normalizedContent(editor.value?.getJSON() ?? capturedContent.value) }),
        beginExternalWrite: (expected) => {
            if (didUnmount || editorDb.value !== db || props.documentId !== id || externalWrite.value
                || JSON.stringify({ title: titleDraft.value, content: normalizedContent(editor.value?.getJSON() ?? capturedContent.value) }) !== JSON.stringify(expected)) {
                throw new Error('This document changed. Update the proposal from a new read.');
            }
            externalWrite.value = true;
            editor.value?.setEditable(false, false);
            if (captureTimer) clearTimeout(captureTimer);
            captureTimer = undefined;
            return () => {
                externalWrite.value = false;
                if (!didUnmount && editorDb.value === db && props.documentId === id) editor.value?.setEditable(!editorLocked.value, false);
            };
        },
        acceptExternalWrite: (row) => {
            if (didUnmount || editorDb.value !== db || props.documentId !== id) return;
            const content = normalizedContent(JSON.parse(row.content) as TipTapDocument);
            acceptCommittedDocument({ id: row.id, title: row.title, content, created_at: row.created_at,
                updated_at: row.updated_at, deleted: row.deleted, file_hashes: row.file_hashes }, db);
            titleDraft.value = row.title;
            capturedTitle = row.title;
            paneConflict.value = false;
            capturedContent.value = content;
            editor.value?.commands.setContent(content, { emitUpdate: false, errorOnInvalidContent: true });
            capturedContent.value = normalizedContent(editor.value?.getJSON() ?? content);
            capturedEditorDocument = editor.value?.state.doc;
            setDocumentEditorConflict(id, conflictKey(), undefined, db);
            contentVersion.value += 1;
            setSerializedSize(new TextEncoder().encode(row.content).byteLength);
            refresh();
        },
        executeChatTool: (name, argsJson, requestId) =>
            ai.executeChatTool(name, argsJson, requestId),
    });
}

async function loadActiveDocument(id: string) {
    const db = editorDb.value;
    if (documentOwnership?.id !== id || documentOwnership.db !== db) {
        const previous = documentOwnership;
        documentOwnership = { id, db, release: retainDocumentEditor(id, db) };
        void previous?.release();
    }
    capturedEditorDocument = undefined;
    const generation = ++loadGeneration;
    imageIntakeFailed.value = false;
    documentLoaded.value = false;
    loadingDocument.value = true;
    loadError.value = '';
    exportError.value = '';
    recoveryMessage.value = '';
    const isCurrent = () => !didUnmount && props.documentId === id &&
        editorDb.value === db && loadGeneration === generation;
    const record = await loadDocument(id, db);
    if (!isCurrent()) return;
    if (!record) {
        loadingDocument.value = false;
        editor.value?.destroy();
        editor.value = null;
        loadedDocumentId = id;
        registerActiveSession(id);
        emit('ready', id);
        return;
    }
    titleDraft.value = state.value.pendingTitle ?? state.value.record?.title ?? '';
    capturedTitle = titleDraft.value;
    paneConflict.value = false;
    capturedContent.value = normalizedContent(state.value.pendingContent !== undefined
        ? state.value.pendingContent : state.value.record?.content);
    contentVersion.value = 0;
    try {
        await makeEditor(isCurrent);
        editor.value?.setEditable(!editorLocked.value, false);
        if (!isCurrent()) return;
        // Lazy extension loading can cross a committed Apply. Use the current origin buffer
        // before registering, then the session lease covers writes still in progress.
        titleDraft.value = state.value.pendingTitle ?? state.value.record?.title ?? '';
        capturedTitle = titleDraft.value;
        capturedContent.value = normalizedContent(state.value.pendingContent !== undefined
            ? state.value.pendingContent : state.value.record?.content);
        const conflict = state.value.editorConflicts?.get(conflictKey());
        if (editor.value) {
            const native = parseNativeDocumentContent(editor.value.schema, conflict?.content ?? capturedContent.value);
            editor.value.commands.setContent(native, { emitUpdate: false, errorOnInvalidContent: true });
        }
        if (conflict) {
            titleDraft.value = conflict.title;
            capturedTitle = conflict.baselineTitle;
            capturedContent.value = conflict.baselineContent;
            paneConflict.value = true;
        } else {
            capturedContent.value = normalizedContent(editor.value?.getJSON() ?? capturedContent.value);
            capturedEditorDocument = editor.value?.state.doc;
        }
        loadedDocumentId = id;
        if (inspectorDefaultApplied.value) inspectorOpen.value = inspectorOpensByDefault();
        documentLoaded.value = true;
        loadingDocument.value = false;
        registerActiveSession(id);
        void focusIfJustCreated();
    } catch {
        if (!isCurrent()) return;
        editor.value?.destroy();
        editor.value = null;
        documentLoaded.value = false;
        loadingDocument.value = false;
        loadError.value = 'The document schema is unavailable. Original content was preserved.';
    }
    emit('ready', id);
}

// The outline only earns its space once the document has headings to list.
function inspectorOpensByDefault(): boolean {
    const current = editor.value;
    if (!current || isCompactToolbar.value) return false;
    let headings = false;
    current.state.doc.descendants((node) => {
        if (node.type.name === 'heading' && Number(node.attrs.level) <= 3) headings = true;
        return !headings;
    });
    return headings;
}

// A document created moments ago with nothing in it: let the user start typing,
// unless they're already typing somewhere else. A still-untitled document gets
// its title selected for naming; a named one puts the caret in the body.
async function focusIfJustCreated(): Promise<void> {
    const record = state.value.record;
    const current = editor.value;
    if (!record || !current || itemReadOnly.value || !current.isEmpty) return;
    if (Date.now() / 1000 - record.created_at > 10) return;
    const active = document.activeElement as HTMLElement | null;
    if (active?.isContentEditable || active?.matches?.('input, textarea, select')) return;
    if (record.title !== DEFAULT_DOCUMENT_TITLE) {
        current.commands.focus('start');
        return;
    }
    await nextTick();
    const title = rootElement.value?.querySelector<HTMLTextAreaElement>('.document-title-field textarea');
    title?.focus();
    title?.select();
}

function onTitleEnter(event: KeyboardEvent) {
    if (event.isComposing) return;
    event.preventDefault();
    editor.value?.commands.focus('start');
}

watch(documentId, async (id, previous) => {
    if (previous && editor.value) {
        void ensureLocalDurability(previous).catch((caught) => {
            console.error('[DocumentEditor] Failed to save before switch', caught);
        });
    }
    if (revisionTimer) clearTimeout(revisionTimer);
    revisionTimer = undefined;
    lastAutomaticRevisionAt = 0;
    revisionGeneration++;
    pendingAutomaticRevision = undefined;
    checkpointError.value = false;
    checkpointBusy.value = false;
    inspectorOpen.value = false;
    inspectorTab.value = 'outline';
    findOpen.value = false;
    findQuery.value = '';
    replaceQuery.value = '';
    findIndex.value = -1;
    slashOpen.value = false;
    overflowOpen.value = false;
    ai.reset();
    await loadActiveDocument(id);
});

const stopWorkspaceSubscription = subscribeActiveWorkspaceDb(() => {
    // The active DB has already changed. Capture the old editor against its
    // own DB before clearing it, including when PageShell unmounts next tick.
    void ensureLocalDurability(props.documentId, editorDb.value).catch((caught) => {
        console.error('[DocumentEditor] Failed to save before workspace switch', caught);
    });
    unregisterSession?.();
    unregisterSession = undefined;
    if (captureTimer) clearTimeout(captureTimer);
    if (revisionTimer) clearTimeout(revisionTimer);
    captureTimer = undefined;
    revisionTimer = undefined;
    editor.value?.destroy();
    editor.value = null;
    documentLoaded.value = false;
    loadedDocumentId = undefined;
    const generation = ++loadGeneration;
    lastAutomaticRevisionAt = 0;
    revisionGeneration++;
    pendingAutomaticRevision = undefined;
    checkpointError.value = false;
    checkpointBusy.value = false;
    editorDb.value = getDb();
    titleDraft.value = '';
    capturedTitle = '';
    paneConflict.value = false;
    capturedContent.value = emptyDocument();
    closeSlashMenu(false);
    findOpen.value = false;
    findQuery.value = '';
    replaceQuery.value = '';
    overflowOpen.value = false;
    ai.reset();
    const db = editorDb.value;
    const id = props.documentId;
    // Workspace tabs may remove this pane on the same Vue update. Only a
    // retained pane should reload, avoiding a missing-doc toast on teardown.
    void nextTick().then(() => {
        if (!didUnmount && editorDb.value === db && loadGeneration === generation && props.documentId === id) {
            void loadActiveDocument(id);
        }
    });
});

watch(
    [() => props.paneId, () => props.tabId],
    () => {
        if (
            loadedDocumentId === props.documentId &&
            editor.value &&
            !editor.value.isDestroyed
        ) {
            registerActiveSession(props.documentId);
        }
    }
);

watch(
    [responsiveHydrated, paneWidthPx, isMobile],
    async () => {
        if (!responsiveHydrated.value || inspectorDefaultApplied.value) return;
        // Wait for a real pane measurement on desktop so narrow split panes
        // don't inherit the wide-layout "inspector open" default.
        if (!isMobile.value && paneWidthPx.value <= 0) return;
        inspectorDefaultApplied.value = true;
        inspectorOpen.value = inspectorOpensByDefault();
        await nextTick();
        inspectorTransitionsReady.value = true;
    },
    { immediate: true },
);

watch(isCompactToolbar, (compact) => {
    if (compact) inspectorOpen.value = false;
});

function syncCleanTitle(): void {
    const record = state.value.record;
    if (!documentLoaded.value || loadedDocumentId !== props.documentId || !record) return;
    const title = state.value.pendingTitle ?? record.title;
    if (titleDraft.value === capturedTitle || titleDraft.value === title) {
        titleDraft.value = title;
        capturedTitle = title;
    }
}

function syncCleanBuffers(): void {
    const current = editor.value;
    const record = state.value.record;
    if (!documentLoaded.value || loadedDocumentId !== props.documentId || !current || current.isDestroyed || !record) return;
    const title = state.value.pendingTitle ?? record.title;
    syncCleanTitle();
    let content: TipTapDocument;
    try {
        content = parseNativeDocumentContent(current.schema, normalizedContent(state.value.pendingContent !== undefined
            ? state.value.pendingContent : record.content));
    } catch {
        loadError.value = 'The document schema is unavailable. Original content was preserved.';
        documentLoaded.value = false;
        current.setEditable(false, false);
        return;
    }
    const serialized = JSON.stringify(content);
    const buffer = JSON.stringify(current.getJSON());
    if (buffer === JSON.stringify(capturedContent.value) || buffer === serialized) {
        capturedContent.value = content;
        if (buffer !== serialized) {
            const view = captureDocumentViewState(props.documentId);
            current.chain().setContent(content, { emitUpdate: false, errorOnInvalidContent: true })
                .setMeta('addToHistory', false).run();
            restoreEditorSelection({ ...view, contentRevision: undefined });
            contentVersion.value += 1;
            editorStateVersion.value += 1;
            setSerializedSize(new TextEncoder().encode(serialized).byteLength);
            refresh();
        }
        if (titleDraft.value === title) {
            paneConflict.value = false;
            setDocumentEditorConflict(props.documentId, conflictKey(), undefined, editorDb.value);
        }
        capturedEditorDocument = current.state.doc;
    }
}

watch(() => [state.value.record?.title, state.value.pendingTitle], syncCleanTitle);
watch(() => [state.value.record?.content, state.value.pendingContent], syncCleanBuffers);

watch(findOpen, async (open) => {
    if (open && !suppressFindAutofocus) {
        await nextTick();
        findInput.value?.inputRef?.focus();
    }
});

watch(findQuery, () => {
    findIndex.value = -1;
});

onMounted(() => {
    window.addEventListener('beforeunload', onBeforePageUnload);
    document.addEventListener('visibilitychange', onDocumentVisibilityChange);
    void loadActiveDocument(props.documentId);
    const root = rootElement.value;
    if (root && typeof ResizeObserver !== 'undefined') {
        const syncPaneWidth = () => {
            paneWidthPx.value = root.getBoundingClientRect().width;
        };
        syncPaneWidth();
        paneResizeObserver = new ResizeObserver(syncPaneWidth);
        paneResizeObserver.observe(root);
    } else if (root) {
        paneWidthPx.value = root.getBoundingClientRect().width;
    }
});
onBeforeUnmount(() => {
    window.removeEventListener('beforeunload', onBeforePageUnload);
    document.removeEventListener('visibilitychange', onDocumentVisibilityChange);
    didUnmount = true;
    revisionGeneration++;
    pendingAutomaticRevision = undefined;
    stopWorkspaceSubscription();
    itemSubscription?.unsubscribe();
    paneResizeObserver?.disconnect();
    paneResizeObserver = undefined;
    ai.abort();
    unregisterSession?.();
    if (captureTimer) clearTimeout(captureTimer);
    if (revisionTimer) clearTimeout(revisionTimer);
    const pending = ensureLocalDurability().catch((caught) => {
        console.error('[DocumentEditor] Failed to save during teardown', caught);
    });
    editor.value?.destroy();
    const ownership = documentOwnership;
    documentOwnership = undefined;
    void pending.then(() => ownership?.release());
});

function onTitleInput(value: string | number | null) {
    if (editorLocked.value) return;
    titleDraft.value = String(value ?? '');
    captureContent();
}

const activeBlock = computed(() => {
    if (editor.value?.isActive('heading', { level: 1 })) return 'heading-1';
    if (editor.value?.isActive('heading', { level: 2 })) return 'heading-2';
    if (editor.value?.isActive('heading', { level: 3 })) return 'heading-3';
    return 'paragraph';
});
const tableActive = computed(() => {
    void editorStateVersion.value;
    return editor.value?.isActive('table') ?? false;
});
const blockTypeItems = DOCUMENT_BLOCK_TYPE_ITEMS;

function runToolbarAction(action: () => unknown) {
    if (!editorLocked.value) action();
}

function shouldShowTextSelection({ state, view, element }: Parameters<NonNullable<BubbleMenuPluginProps['shouldShow']>>[0]) {
    const { selection } = state;
    return !editorLocked.value && isTextSelection(selection) && !selection.empty
        && !!state.doc.textBetween(selection.from, selection.to).length
        && (view.hasFocus() || element.contains(document.activeElement));
}

function setBlockType(value: string | number | undefined) {
    if (editorLocked.value) return;
    if (typeof value !== 'string') return;
    const chain = editor.value?.chain().focus();
    if (!chain) return;
    if (value === 'paragraph') chain.setParagraph().run();
    else chain.toggleHeading({ level: Number(value.slice(-1)) as 1 | 2 | 3 }).run();
}

// Resolved after mount so server and first client render agree (Apple glyphs).
const appleShortcuts = ref(true);
onMounted(() => { appleShortcuts.value = isApplePlatform(); });
function shortcut(key: string, shift = false): string {
    return formatShortcut(key, { shift, apple: appleShortcuts.value });
}

const formatButtons = computed<DocumentToolbarItem[]>(() => [
    {
        id: 'bold',
        icon: icons.bold,
        label: `Bold (${shortcut('b')})`,
        active: () => editor.value?.isActive('bold') ?? false,
        run: () => {
            editor.value?.chain().focus().toggleBold().run();
        },
    },
    {
        id: 'italic',
        icon: icons.italic,
        label: `Italic (${shortcut('i')})`,
        active: () => editor.value?.isActive('italic') ?? false,
        run: () => {
            editor.value?.chain().focus().toggleItalic().run();
        },
    },
    {
        id: 'underline',
        icon: icons.underline,
        label: `Underline (${shortcut('u')})`,
        active: () => editor.value?.isActive('underline') ?? false,
        run: () => {
            editor.value?.chain().focus().toggleUnderline().run();
        },
    },
    {
        id: 'strike',
        icon: icons.strike,
        label: 'Strikethrough',
        active: () => editor.value?.isActive('strike') ?? false,
        run: () => {
            editor.value?.chain().focus().toggleStrike().run();
        },
    },
    {
        id: 'code',
        icon: icons.code,
        label: 'Inline code',
        active: () => editor.value?.isActive('code') ?? false,
        run: () => {
            editor.value?.chain().focus().toggleCode().run();
        },
    },
    {
        id: 'link',
        icon: icons.link,
        label: 'Link',
        active: () => editor.value?.isActive('link') ?? false,
        run: editLink,
    },
]);
/** Compact panes keep B/I/U in the scroll rail; advanced marks stay in overflow. */
const visibleFormatButtons = computed(() =>
    isCompactToolbar.value ? formatButtons.value.slice(0, 3) : formatButtons.value
);
const insertButtons = computed<DocumentToolbarItem[]>(() => [
    {
        id: 'bullet',
        icon: icons.bulletList,
        label: 'Bullet list',
        active: () => editor.value?.isActive('bulletList') ?? false,
        run: () => {
            editor.value?.chain().focus().toggleBulletList().run();
        },
    },
    {
        id: 'ordered',
        icon: icons.orderedList,
        label: 'Numbered list',
        active: () => editor.value?.isActive('orderedList') ?? false,
        run: () => {
            editor.value?.chain().focus().toggleOrderedList().run();
        },
    },
    {
        id: 'tasks',
        icon: icons.taskList,
        label: 'Task list',
        active: () => editor.value?.isActive('taskList') ?? false,
        run: () => {
            editor.value?.chain().focus().toggleTaskList().run();
        },
    },
    {
        id: 'quote',
        icon: icons.quote,
        label: 'Quote',
        active: () => editor.value?.isActive('blockquote') ?? false,
        run: () => {
            editor.value?.chain().focus().toggleBlockquote().run();
        },
    },
]);
const imageInsertButton = computed<DocumentToolbarItem>(() => ({
    id: 'image',
    icon: icons.image,
    label: 'Image',
    run: () => imageInput.value?.click(),
}));
/** Notion/Docs-style essentials in the horizontally scrollable compact rail. */
const compactQuickInsertButtons = computed<DocumentToolbarItem[]>(() => [
    insertButtons.value[0]!,
    insertButtons.value[1]!,
    imageInsertButton.value,
]);
const overflowButtons = computed<DocumentToolbarItem[]>(() => [
    {
        id: 'codeblock',
        icon: icons.codeBlock,
        label: 'Code block',
        run: () => {
            editor.value?.chain().focus().toggleCodeBlock().run();
        },
    },
    {
        id: 'divider',
        icon: icons.divider,
        label: 'Divider',
        run: () => {
            editor.value?.chain().focus().setHorizontalRule().run();
        },
    },
    { id: 'table', icon: icons.table, label: 'Table', run: openTableDialog },
    imageInsertButton.value,
]);
const mobileHeadingLabel = computed(() => {
    const current = DOCUMENT_BLOCK_TYPE_ITEMS.find(
        (item) => item.value === activeBlock.value
    );
    return current?.label ?? 'Text';
});
const mobileHeadingShortLabel = computed(() => {
    if (activeBlock.value === 'heading-1') return 'H1';
    if (activeBlock.value === 'heading-2') return 'H2';
    if (activeBlock.value === 'heading-3') return 'H3';
    return 'T';
});
const mobileHeadingMenuItems = computed(() => [
    DOCUMENT_BLOCK_TYPE_ITEMS.map((item) => ({
        label: item.label,
        icon:
            item.value === 'heading-1'
                ? icons.heading1
                : item.value === 'heading-2'
                  ? icons.heading2
                  : item.value === 'heading-3'
                    ? icons.heading3
                    : icons.text,
        onSelect: () => setBlockType(item.value),
    })),
]);
const toolbarOverflowItems = computed(() => {
    const compactButtons = isCompactToolbar.value
        ? [
              // Find stays in overflow on true mobile (no trailing find button).
              ...(isMobile.value
                  ? [
                        {
                            id: 'find',
                            icon: icons.search,
                            label: 'Find in document',
                            run: () => {
                                findOpen.value = true;
                            },
                        },
                    ]
                  : []),
              ...formatButtons.value.filter(
                  (button) => !isDocumentMobilePrimaryToolId(button.id)
              ),
              ...insertButtons.value.filter(
                  (button) => !isDocumentMobilePrimaryToolId(button.id)
              ),
              ...overflowButtons.value.filter(
                  (button) => !isDocumentMobilePrimaryToolId(button.id)
              ),
              {
                  id: 'undo',
                  icon: icons.undo,
                  label: `Undo (${shortcut('z')})`,
                  run: () => editor.value?.chain().focus().undo().run(),
              },
              {
                  id: 'redo',
                  icon: icons.redo,
                  label: `Redo (${shortcut('z', true)})`,
                  run: () => editor.value?.chain().focus().redo().run(),
              },
          ]
        : overflowButtons.value;
    const actionItems = compactButtons.map((button) => ({
        label: button.label,
        icon: button.icon || icons.plugin,
        onSelect: () => runToolbarAction(button.run),
    }));
    return [
        actionItems,
        ...(pluginButtons.value.length
            ? [
                  pluginButtons.value.map((button) => {
                      const label = button.tooltip || button.id;
                      const icon = button.icon || icons.plugin;
                      // Toggles show their on/off state instead of a bare "Toggle …" action.
                      if (button.isActive && editor.value) {
                          return {
                              type: 'checkbox' as const,
                              label,
                              icon,
                              checked: button.isActive(editor.value),
                              onUpdateChecked: () => handlePluginButton(button),
                          };
                      }
                      return { label, icon, onSelect: () => handlePluginButton(button) };
                  }),
              ]
            : []),
    ];
});

function handlePluginButton(button: EditorToolbarButton) {
    if (editorLocked.value) return;
    if (editor.value) void button.onClick(editor.value);
}

function editLink() {
    if (editorLocked.value) return;
    const current = editor.value;
    if (!current) return;
    linkHref.value = (current.getAttributes('link').href as string | undefined) || 'https://';
    linkError.value = '';
    linkDialogOpen.value = true;
}

function applyLink() {
    if (editorLocked.value) return;
    const current = editor.value;
    if (!current) return;
    const href = linkHref.value.trim();
    if (!href) {
        removeLink();
        return;
    }
    if (!isAllowedDocumentHref(href)) {
        linkError.value = 'Use an http, https, mailto, or relative link.';
        return;
    }
    current.chain().focus().extendMarkRange('link').setLink({ href }).run();
    linkDialogOpen.value = false;
}

function removeLink() {
    if (editorLocked.value) return;
    editor.value?.chain().focus().extendMarkRange('link').unsetLink().run();
    linkDialogOpen.value = false;
}

function normalizeTableDimension(value: number) {
    const numericValue = Number(value);
    const finiteValue = Number.isFinite(numericValue) ? Math.round(numericValue) : 3;
    return Math.min(20, Math.max(1, finiteValue));
}

function openTableDialog() {
    if (editorLocked.value) return;
    tableRows.value = 3;
    tableColumns.value = 3;
    tableHeaderRow.value = true;
    tableDialogOpen.value = true;
}

function insertTable() {
    if (editorLocked.value) return;
    const rows = normalizeTableDimension(tableRows.value);
    const cols = normalizeTableDimension(tableColumns.value);
    tableRows.value = rows;
    tableColumns.value = cols;
    editor.value?.chain().focus().insertTable({ rows, cols, withHeaderRow: tableHeaderRow.value }).run();
    tableDialogOpen.value = false;
    editorStateVersion.value += 1;
}

function onImageInput(event: Event) {
    const input = event.target as HTMLInputElement;
    void insertFiles([...(input.files ?? [])]);
    input.value = '';
}

const slashCommands = computed(() => [
    {
        id: 'text',
        label: 'Text',
        description: 'Plain paragraph',
        icon: icons.text,
        run: () => editor.value?.chain().focus().setParagraph().run(),
    },
    {
        id: 'h1',
        label: 'Heading 1',
        description: 'Large section heading',
        icon: icons.heading1,
        run: () => editor.value?.chain().focus().setHeading({ level: 1 }).run(),
    },
    {
        id: 'h2',
        label: 'Heading 2',
        description: 'Medium section heading',
        icon: icons.heading2,
        run: () => editor.value?.chain().focus().setHeading({ level: 2 }).run(),
    },
    {
        id: 'task',
        label: 'Task list',
        description: 'Track action items',
        icon: icons.taskList,
        run: () => editor.value?.chain().focus().toggleTaskList().run(),
    },
    {
        id: 'bullet',
        label: 'Bullet list',
        description: 'Create a simple list',
        icon: icons.bulletList,
        run: () => editor.value?.chain().focus().toggleBulletList().run(),
    },
    {
        id: 'quote',
        label: 'Quote',
        description: 'Emphasize a passage',
        icon: icons.quote,
        run: () => editor.value?.chain().focus().toggleBlockquote().run(),
    },
    {
        id: 'code',
        label: 'Code block',
        description: 'Write formatted code',
        icon: icons.codeBlock,
        run: () => editor.value?.chain().focus().toggleCodeBlock().run(),
    },
    {
        id: 'table',
        label: 'Table',
        description: 'Insert a custom-size table',
        icon: icons.table,
        run: openTableDialog,
    },
    {
        id: 'image',
        label: 'Image',
        description: 'Upload an offline-first image',
        icon: icons.image,
        run: () => imageInput.value?.click(),
    },
    {
        id: 'divider',
        label: 'Divider',
        description: 'Separate sections',
        icon: icons.divider,
        run: () => editor.value?.chain().focus().setHorizontalRule().run(),
    },
]);
const filteredSlashCommands = computed(() => slashCommands.value.filter((command) => `${command.label} ${command.description}`.toLowerCase().includes(slashQuery.value)).slice(0, 8));

function runSlashCommand(command: (typeof slashCommands.value)[number]) {
    const current = editor.value;
    if (!current || editorLocked.value) return;
    updateSlashMenu();
    if (!slashOpen.value) return;
    const from = current.state.selection.$from.start();
    current.chain().focus().deleteRange({ from, to: current.state.selection.from }).run();
    command.run();
    slashOpen.value = false;
    slashDismissed.value = false;
}

function closeSlashMenu(restoreFocus = true) {
    slashDismissed.value = true;
    slashOpen.value = false;
    if (restoreFocus) editor.value?.commands.focus();
}

const searchMatches = computed(() => {
    void contentVersion.value;
    const current = editor.value;
    const needle = findQuery.value;
    if (!current || !needle) return [] as Array<{ from: number; to: number }>;
    const pattern = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'giu');
    const results: Array<{ from: number; to: number }> = [];
    current.state.doc.descendants((node, position) => {
        if (!node.isTextblock) return;
        // Inline marks split text nodes; atom placeholders preserve document offsets.
        const text = node.textBetween(0, node.content.size, '', '\ufffc');
        for (const match of text.matchAll(pattern)) {
            results.push({
                from: position + 1 + match.index,
                to: position + 1 + match.index + match[0].length,
            });
        }
        return false;
    });
    return results;
});
const findStatus = computed(() => {
    const count = searchMatches.value.length;
    return count ? `${Math.min(count, Math.max(1, findIndex.value + 1))} / ${count}` : 'No results';
});
function selectMatch(index: number) {
    const results = searchMatches.value;
    if (!results.length) return;
    findIndex.value = (index + results.length) % results.length;
    editor.value?.chain().focus().setTextSelection(results[findIndex.value]!).scrollIntoView().run();
}
function findNext() {
    selectMatch(findIndex.value + 1);
}
function findPrevious() {
    selectMatch(findIndex.value < 0 ? -1 : findIndex.value - 1);
}
function replaceCurrent() {
    const current = editor.value;
    const index = Math.max(0, findIndex.value);
    const match = searchMatches.value[index];
    if (!current || editorLocked.value || !match) return;
    current.view.dispatch(current.state.tr.insertText(replaceQuery.value, match.from, match.to));
    findIndex.value = index - 1;
    findNext();
}
function replaceAll() {
    const current = editor.value;
    if (!current || editorLocked.value || !searchMatches.value.length) return;
    const tr = current.state.tr;
    for (const match of [...searchMatches.value].reverse()) tr.insertText(replaceQuery.value, match.from, match.to);
    current.view.dispatch(tr);
    findIndex.value = -1;
}

function focusCanvas(event: MouseEvent) {
    if (event.target === event.currentTarget) editor.value?.commands.focus('end');
}

function toggleInspector(tab = inspectorTab.value) {
    inspectorTab.value = tab;
    inspectorOpen.value = !inspectorOpen.value;
}

let pendingOutlineSelection: DocumentOutlineItem | undefined;
async function onOutlineSelect(item: DocumentOutlineItem) {
    if (isCompactToolbar.value && inspectorOpen.value) {
        pendingOutlineSelection = item;
        inspectorOpen.value = false;
        return;
    }
    await nextTick();
    scrollTo(item, editorScroll.value);
}

async function onInspectorClosed() {
    const item = pendingOutlineSelection;
    pendingOutlineSelection = undefined;
    if (!item) return;
    await nextTick();
    scrollTo(item, editorScroll.value);
}

async function onInspectorRestore(revision: CompleteDocumentRevision) {
    restoreError.value = '';
    try {
        await restoreRevision(revision);
        if (isCompactToolbar.value) inspectorOpen.value = false;
    } catch (caught) {
        restoreError.value = 'This version could not be restored. Your current document is retained. Review it and try again.';
        console.error('[DocumentEditor] Restore failed', caught);
        throw new Error(restoreError.value);
    }
}

function openAiForSelection() {
    aiFocusNonce.value += 1;
}

function onAiComposerFocusOut(event: FocusEvent) {
    const dock = event.currentTarget as HTMLElement;
    if (!dock.contains(event.relatedTarget as Node | null)) aiComposerFocused.value = false;
}

// The browser drops its selection highlight once focus moves to the AI input,
// so tint the text the AI will edit while the composer has focus.
const aiBusy = computed(() =>
    ai.status.value === 'preparing' || ai.status.value === 'streaming' || ai.status.value === 'preview' || Boolean(ai.proposal.value)
);
watch([aiComposerFocused, selectionAvailable, aiBusy], ([focused, hasSelection]) => {
    if (focused && hasSelection) ai.syncScopeHighlight('selection', 'show');
    else ai.syncScopeHighlight(undefined, 'clear');
}, { flush: 'post' });

function clearAiSelection() {
    const current = editor.value;
    if (!current || current.state.selection.empty) return;
    current.commands.setTextSelection(current.state.selection.to);
}

function toggleAutocomplete() {
    AutocompleteState.value.isEnabled = !AutocompleteState.value.isEnabled;
    if (AutocompleteState.value.isEnabled) AutocompleteState.value.lastError = null;
    editor.value?.commands.focus();
}

async function runAi(payload: DocumentAiSubmission) {
    if (itemReadOnly.value || externalWrite.value) return;
    try {
        await ai.submit(payload);
    } catch (caught) {
        console.error('[DocumentAI] submit failed', caught);
    }
}
async function estimateAi(payload: DocumentAiEstimateRequest) {
    if (itemReadOnly.value || externalWrite.value) return;
    await ai.estimate(payload).catch(() => 0);
}
async function acceptAi() {
    if (itemReadOnly.value || externalWrite.value) return;
    try {
        await ai.accept();
    } catch (caught) {
        console.error('[DocumentAI] accept failed', caught);
    }
}
async function acceptAiHunk(id: string) {
    if (itemReadOnly.value || externalWrite.value) return;
    try {
        await ai.acceptHunk(id);
    } catch (caught) {
        console.error('[DocumentAI] accept hunk failed', caught);
    }
}

async function restoreRevision(revision: CompleteDocumentRevision) {
    const current = editor.value;
    const db = editorDb.value;
    const id = props.documentId;
    if (!current || editorLocked.value || revision.manifest.documentId !== id) throw new Error('This document is not available for restore.');
    const before = current.state.doc;
    const version = contentVersion.value;
    const title = titleDraft.value;
    const generation = getWorkspaceGeneration();
    const account = getCachedSessionContext()?.user?.id ?? null;
    const assertCurrent = () => {
        if (didUnmount || current.isDestroyed || editor.value !== current || editorDb.value !== db
            || getDb() !== db || props.documentId !== id || getWorkspaceGeneration() !== generation
            || (getCachedSessionContext()?.user?.id ?? null) !== account
            || itemReadOnly.value || externalWrite.value || current.state.doc !== before
            || contentVersion.value !== version || titleDraft.value !== title) {
            throw new Error('The document changed while preparing the restore.');
        }
    };
    restoring.value = true;
    try {
        const replacement = await validateDocumentContent(current.schema, revision.snapshot.content, db);
        assertCurrent();
        await createDocumentRevision({ documentId: id, title, content: before.toJSON(), source: 'restore' }, db);
        const row = await db.posts.get(id);
        assertCurrent();
        if (!row || row.postType !== 'doc' || !isVisibleWorkspaceItem(row)) throw new Error('This document is unavailable.');
        current.commands.setContent(replacement, { emitUpdate: true, errorOnInvalidContent: true });
        titleDraft.value = revision.snapshot.title;
        setDocumentTitle(id, titleDraft.value, db);
        await ensureLocalDurability(id, db);
    } finally {
        restoring.value = false;
    }
}

async function createManualCheckpoint() {
    const current = editor.value;
    if (!current) return;
    await createDocumentRevision({
        documentId: props.documentId,
        title: titleDraft.value,
        content: current.getJSON(),
        source: 'manual',
    }, editorDb.value);
}
</script>

<style scoped src="./DocumentEditorRoot.css"></style>
<style scoped src="../../assets/css/or3-prose.css"></style>
