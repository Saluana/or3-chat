import { computed, ref } from 'vue';
import { getDb } from '~/db/client';
import { getKvByName, setKvByName } from '~/db/kv';
import type { DocumentAiScope } from '~/composables/editor/useDocumentAiActions';
import {
    clampDocumentAiChunkWords,
    DEFAULT_DOCUMENT_AI_CHUNK_WORDS,
} from '~/utils/documents/document-ai-index';

export const DOCUMENT_AI_SETTINGS_KEY = 'document_ai_settings.v1';

export const DEFAULT_DOCUMENT_AI_MAX_ITERATIONS = 8;
export const MIN_DOCUMENT_AI_MAX_ITERATIONS = 2;
export const MAX_DOCUMENT_AI_MAX_ITERATIONS = 20;

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
    /** Max agent tool-loop turns before forcing a stop. */
    maxIterations: number;
    /** Target size for each read_blocks chunk, in words. */
    chunkWordLimit: number;
    /**
     * Per-tool allowlist for Document AI.
     * Missing keys use defaults: native document tools ON, chat-registry tools OFF.
     */
    enabledTools: Record<string, boolean>;
}

export const DEFAULT_DOCUMENT_AI_SETTINGS: DocumentAiSettingsV1 = {
    version: 1,
    modelId: null,
    systemInstruction: 'Preserve the author’s intent, voice, and factual meaning. Make the smallest complete change requested, keeping unrelated structure and formatting intact.',
    quickActions: [
        { id: 'improve', label: 'Improve writing', prompt: 'Improve clarity, flow, and precision.', defaultScope: 'section' },
        { id: 'shorten', label: 'Make concise', prompt: 'Make this more concise without losing important meaning.', defaultScope: 'selection' },
        { id: 'summarize', label: 'Summarize', prompt: 'Create a crisp summary of this content.', defaultScope: 'section' },
        { id: 'actions', label: 'Extract actions', prompt: 'Turn concrete next steps into a task list.', defaultScope: 'section' },
    ],
    maxIterations: DEFAULT_DOCUMENT_AI_MAX_ITERATIONS,
    chunkWordLimit: DEFAULT_DOCUMENT_AI_CHUNK_WORDS,
    enabledTools: {},
};

function sanitizeEnabledTools(value: unknown): Record<string, boolean> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const out: Record<string, boolean> = {};
    for (const [rawName, enabled] of Object.entries(value as Record<string, unknown>)) {
        if (typeof rawName !== 'string' || typeof enabled !== 'boolean') continue;
        const name = rawName.trim();
        if (!name || name.length > 80) continue;
        out[name] = enabled;
        if (Object.keys(out).length >= 200) break;
    }
    return out;
}

const settings = ref<DocumentAiSettingsV1>({ ...DEFAULT_DOCUMENT_AI_SETTINGS });
let loadedDb = '';
let loadPromise: Promise<void> | null = null;

function scope(value: unknown): DocumentAiScope {
    return value === 'selection' || value === 'document' ? value : 'section';
}

export function clampDocumentAiMaxIterations(value: unknown): number {
    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric)) return DEFAULT_DOCUMENT_AI_MAX_ITERATIONS;
    return Math.min(
        MAX_DOCUMENT_AI_MAX_ITERATIONS,
        Math.max(MIN_DOCUMENT_AI_MAX_ITERATIONS, Math.round(numeric)),
    );
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
        maxIterations: clampDocumentAiMaxIterations(
            input.maxIterations ?? DEFAULT_DOCUMENT_AI_MAX_ITERATIONS,
        ),
        chunkWordLimit: clampDocumentAiChunkWords(
            input.chunkWordLimit ?? DEFAULT_DOCUMENT_AI_CHUNK_WORDS,
        ),
        enabledTools: sanitizeEnabledTools(input.enabledTools),
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
