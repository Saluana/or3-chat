import { computed, ref } from 'vue';
import { getDb } from '~/db/client';
import { getKvByName, setKvByName } from '~/db/kv';
import type { DocumentAiScope } from '~/composables/editor/useDocumentAiActions';

export const DOCUMENT_AI_SETTINGS_KEY = 'document_ai_settings.v1';

export interface DocumentAiQuickActionSetting {
    id: string;
    label: string;
    prompt: string;
    defaultScope: DocumentAiScope;
}

export interface DocumentAiSettingsV1 {
    version: 1;
    modelId: string | null;
    systemInstruction: string;
    quickActions: DocumentAiQuickActionSetting[];
}

export const DEFAULT_DOCUMENT_AI_SETTINGS: DocumentAiSettingsV1 = {
    version: 1,
    modelId: null,
    systemInstruction: 'Edit with restraint. Preserve the author’s meaning, voice, structure, and supported document node types unless the request requires a change.',
    quickActions: [
        { id: 'improve', label: 'Improve writing', prompt: 'Improve clarity, flow, and precision.', defaultScope: 'section' },
        { id: 'shorten', label: 'Make concise', prompt: 'Make this more concise without losing important meaning.', defaultScope: 'selection' },
        { id: 'summarize', label: 'Summarize', prompt: 'Create a crisp summary of this content.', defaultScope: 'section' },
        { id: 'actions', label: 'Extract actions', prompt: 'Turn concrete next steps into a task list.', defaultScope: 'section' },
    ],
};

const settings = ref<DocumentAiSettingsV1>({ ...DEFAULT_DOCUMENT_AI_SETTINGS });
let loadedDb = '';
let loadPromise: Promise<void> | null = null;

function scope(value: unknown): DocumentAiScope {
    return value === 'selection' || value === 'document' ? value : 'section';
}

export function sanitizeDocumentAiSettings(value: unknown): DocumentAiSettingsV1 {
    const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const actions = Array.isArray(input.quickActions)
        ? input.quickActions.slice(0, 12).flatMap((item, index) => {
            if (!item || typeof item !== 'object') return [];
            const action = item as Record<string, unknown>;
            const label = typeof action.label === 'string' ? action.label.trim().slice(0, 60) : '';
            const prompt = typeof action.prompt === 'string' ? action.prompt.trim().slice(0, 2000) : '';
            if (!label || !prompt) return [];
            return [{
                id: typeof action.id === 'string' && action.id.trim()
                    ? action.id.trim().slice(0, 80)
                    : `action-${index}`,
                label,
                prompt,
                defaultScope: scope(action.defaultScope),
            }];
        })
        : DEFAULT_DOCUMENT_AI_SETTINGS.quickActions;
    return {
        version: 1,
        modelId: typeof input.modelId === 'string' && input.modelId.trim()
            ? input.modelId.trim()
            : null,
        systemInstruction: typeof input.systemInstruction === 'string'
            ? input.systemInstruction.slice(0, 8000)
            : DEFAULT_DOCUMENT_AI_SETTINGS.systemInstruction,
        quickActions: actions,
    };
}

async function ensureLoaded() {
    const dbName = getDb().name;
    if (loadedDb === dbName) return;
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
        try {
            const row = await getKvByName(DOCUMENT_AI_SETTINGS_KEY);
            settings.value = row?.value
                ? sanitizeDocumentAiSettings(JSON.parse(row.value))
                : { ...DEFAULT_DOCUMENT_AI_SETTINGS };
            loadedDb = dbName;
        } catch {
            settings.value = { ...DEFAULT_DOCUMENT_AI_SETTINGS };
            loadedDb = dbName;
        } finally {
            loadPromise = null;
        }
    })();
    return loadPromise;
}

export function useDocumentAiSettings() {
    if (import.meta.client) void ensureLoaded();
    async function update(patch: Partial<DocumentAiSettingsV1>) {
        await ensureLoaded();
        const next = sanitizeDocumentAiSettings({ ...settings.value, ...patch });
        settings.value = next;
        await setKvByName(DOCUMENT_AI_SETTINGS_KEY, JSON.stringify(next));
    }
    return {
        settings: computed(() => settings.value),
        ensureLoaded,
        update,
        reset: () => update(DEFAULT_DOCUMENT_AI_SETTINGS),
    };
}
