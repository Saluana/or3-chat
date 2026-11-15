/** Cloud keeps the OpenAI key in the account vault; static/local deployments keep it in this device's local-only KV. */
import { computed, onScopeDispose, reactive, ref, watch } from 'vue';
import { useRuntimeConfig, useState } from '#imports';
import type { SessionPayload } from '~/composables/auth/useSessionContext';
import { isOpenAiModel } from '~~/shared/openai/models';
import { getKvByName, hardDeleteKvByName, setKvByName } from '~/db/kv';
import { getWorkspaceGeneration, subscribeActiveWorkspaceDb } from '~/db/client';

const LOCAL_KEY = 'openai_api_key';
const OPENAI_KEY_FORMAT = /^sk-[A-Za-z0-9_-]{20,512}$/;
const connection = reactive({ connected: false, available: true, instance: false });
const cloudMode = () => useRuntimeConfig().public.ssrAuthEnabled === true;
let keyGeneration = 0;
let statusGeneration = 0;
let mutationGeneration = 0;
let scopeRevision = 0;
const connectionScope = ref('');

function scopeFor(session: SessionPayload | null, cloud: boolean): string {
    const current = session?.session;
    return cloud
        ? JSON.stringify([current?.authenticated === true, current?.provider, current?.user?.id, current?.workspace?.id])
        : `local:${getWorkspaceGeneration()}`;
}

function beginStatus(operation: 'status' | 'mutation') {
    const cloud = cloudMode();
    const session = useState<SessionPayload | null>('auth-session', () => null);
    const scope = scopeFor(session.value, cloud);
    const generation = ++statusGeneration;
    const mutation = operation === 'mutation' ? ++mutationGeneration : mutationGeneration;
    const revision = scopeRevision;
    return {
        session: session.value?.session,
        apply(result: { connected: boolean; available: boolean; instance: boolean }) {
            if (scope !== scopeFor(session.value, cloud) || revision !== scopeRevision) throw new Error('The signed-in account or workspace changed. Refresh and try again.');
            if (operation === 'status') {
                if (generation !== statusGeneration) return;
            } else {
                if (mutation !== mutationGeneration) return;
                // Status requests started while the mutation was in flight may
                // have read the old value; they cannot overwrite its result.
                statusGeneration++;
            }
            connectionScope.value = scope;
            Object.assign(connection, result);
        },
    };
}

/** Changes whenever this device's key is saved or removed, so in-flight work can detect a swap. */
export function getOpenAiKeyGeneration(): number { return keyGeneration; }

/** This device's key for local installs; Cloud keys never reach the browser. */
export async function readLocalOpenAiKey(): Promise<string | null> {
    try { return (await getKvByName(LOCAL_KEY))?.value || null; } catch { return null; }
}

async function credentialRequest(operation: 'status' | 'save' | 'delete', key?: string): Promise<void> {
    const request = beginStatus(operation === 'status' ? 'status' : 'mutation');
    const session = request.session;
    if (!session?.authenticated || !session.user?.id) throw new Error('Sign in to connect OpenAI.');
    const response = await fetch('/api/openai/credentials', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        headers: { 'content-type': 'application/json', 'x-or3-cloud-intent': 'mutation',
            'x-or3-account': JSON.stringify([session.provider, session.user.id]) },
        body: JSON.stringify({ operation, ...(key === undefined ? {} : { key }) }),
    });
    if (!response.ok) throw new Error(response.status === 409 ? 'The connection or signed-in account changed. Refresh and try again.'
        : 'OpenAI credential storage is unavailable. Try again or contact the administrator.');
    const result = await response.json() as { connected?: unknown; available?: unknown; instance?: unknown };
    request.apply({ connected: result.connected === true, available: result.available !== false, instance: result.instance === true });
}

export async function refreshOpenAiConnection(): Promise<void> {
    if (cloudMode()) await credentialRequest('status');
    else {
        const request = beginStatus('status');
        const connected = Boolean(await readLocalOpenAiKey());
        request.apply({ connected, available: true, instance: false });
    }
}

export async function saveOpenAiKey(input: string): Promise<void> {
    const key = input.trim();
    if (!OPENAI_KEY_FORMAT.test(key)) throw new Error('Enter an OpenAI API key that starts with "sk-".');
    if (cloudMode()) return credentialRequest('save', key);
    const request = beginStatus('mutation');
    try { await setKvByName(LOCAL_KEY, key); } catch { throw new Error('This browser could not save the key.'); }
    keyGeneration++;
    request.apply({ connected: true, available: true, instance: false });
}

export async function removeOpenAiKey(): Promise<void> {
    if (cloudMode()) return credentialRequest('delete');
    const request = beginStatus('mutation');
    await hardDeleteKvByName(LOCAL_KEY);
    keyGeneration++;
    request.apply({ connected: false, available: true, instance: false });
}

/** Local mode forwards the device key to the OR3 server, for OpenAI models only. */
export async function openAiKeyHeaders(model: unknown): Promise<Record<string, string>> {
    if (cloudMode() || !isOpenAiModel(model)) return {};
    const key = await readLocalOpenAiKey();
    return key ? { 'x-or3-openai-key': key } : {};
}

export function useOpenAiKey() {
    const session = useState<SessionPayload | null>('auth-session', () => null);
    const workspaceGeneration = ref(getWorkspaceGeneration());
    if (import.meta.client) {
        const stop = subscribeActiveWorkspaceDb(() => { workspaceGeneration.value = getWorkspaceGeneration(); });
        onScopeDispose(stop);
    }
    const scope = computed(() => {
        void workspaceGeneration.value;
        return scopeFor(session.value, cloudMode());
    });
    watch(scope, () => { statusGeneration++; scopeRevision++; }, { flush: 'sync' });
    const visibleConnection = computed(() => connectionScope.value === scope.value
        ? { ...connection } : { connected: false, available: true, instance: false });
    return { connection: visibleConnection, scope, refresh: refreshOpenAiConnection, save: saveOpenAiKey, remove: removeOpenAiKey };
}
