import { useRuntimeConfig } from '#imports';
import { getWorkspaceGeneration, type Or3DB } from '~/db/client';
import { getKvRecordByName } from '~/db/kv';
import { sanitizeAiSettings } from '~/composables/chat/useAiSettings';
import { DEFAULT_FAST_MODEL, FastModelSchema } from '~~/shared/ai/fast-model';
import { isOpenAiModel } from '~~/shared/openai/models';
import { getOpenAiKeyGeneration, readLocalOpenAiKey } from '~/core/auth/useOpenAiKey';
import { getUserApiKeyGeneration, useUserApiKey } from '~/core/auth/useUserApiKey';

/** This workspace's saved fast model, read from its own database rather than the shared settings cache. */
export async function readLocalFastModel(db: Or3DB): Promise<string> {
    try {
        const record = await getKvRecordByName('ai_settings', db);
        return sanitizeAiSettings(record.row?.value ? JSON.parse(record.row.value) as unknown : null).titleGenerationModel;
    } catch { return DEFAULT_FAST_MODEL; }
}

let cloudModel: { generation: number; model: Promise<string> } | null = null;

/** Cloud reads the workspace setting once per workspace; local installs read this device's settings. */
export function resolveFastModel(db: Or3DB): Promise<string> {
    if (useRuntimeConfig().public.ssrAuthEnabled !== true) return readLocalFastModel(db);
    const generation = getWorkspaceGeneration();
    if (cloudModel?.generation !== generation) {
        const model: Promise<string> = fetch('/api/openrouter/title-model', { cache: 'no-store', credentials: 'same-origin' })
            .then(async (response) => {
                if (!response.ok) throw new Error('Fast model unavailable.');
                return FastModelSchema.parse((await response.json() as { model?: unknown }).model);
            })
            // A failed read falls back to the default and is retried by the next caller.
            .catch(() => { if (cloudModel?.model === model) cloudModel = null; return DEFAULT_FAST_MODEL; });
        cloudModel = { generation, model };
    }
    return cloudModel.model;
}

/** Called after this tab saves a new fast model. */
export function forgetFastModel(): void { cloudModel = null; }

/**
 * Browser inference for local installs: the fast model with this device's key for its router.
 * `current()` is synchronous so it can run inside a Dexie transaction.
 */
export async function resolveLocalInference(db: Or3DB): Promise<{ fastModel: string; apiKey: string; baseUrl: unknown; current(): boolean } | null> {
    const fastModel = await readLocalFastModel(db);
    if (isOpenAiModel(fastModel)) {
        const generation = getOpenAiKeyGeneration();
        const apiKey = await readLocalOpenAiKey();
        // OpenAI inference is sent to the OR3 server with this key; the server owns the base URL.
        return apiKey ? { fastModel, apiKey, baseUrl: undefined, current: () => getOpenAiKeyGeneration() === generation } : null;
    }
    const { apiKey: stored } = useUserApiKey();
    const apiKey = stored.value;
    const generation = getUserApiKeyGeneration();
    return apiKey ? { fastModel, apiKey, baseUrl: (useRuntimeConfig().public as { openRouter?: { baseUrl?: string } }).openRouter?.baseUrl,
        current: () => getUserApiKeyGeneration() === generation && stored.value === apiKey } : null;
}
