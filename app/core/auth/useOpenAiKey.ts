/** Cloud keeps the OpenAI key in the account vault; static/local deployments keep it in this device's local-only KV. */
import { reactive, readonly } from 'vue';
import { useRuntimeConfig, useState } from '#imports';
import type { SessionPayload } from '~/composables/auth/useSessionContext';
import { isOpenAiModel } from '~~/shared/openai/models';
import { getKvByName, hardDeleteKvByName, setKvByName } from '~/db/kv';

const LOCAL_KEY = 'openai_api_key';
const OPENAI_KEY_FORMAT = /^sk-[A-Za-z0-9_-]{20,512}$/;
const connection = reactive({ connected: false, available: true, instance: false });
const cloudMode = () => useRuntimeConfig().public.ssrAuthEnabled === true;
let keyGeneration = 0;

/** Changes whenever this device's key is saved or removed, so in-flight work can detect a swap. */
export function getOpenAiKeyGeneration(): number { return keyGeneration; }

/** This device's key for local installs; Cloud keys never reach the browser. */
export async function readLocalOpenAiKey(): Promise<string | null> {
    try { return (await getKvByName(LOCAL_KEY))?.value || null; } catch { return null; }
}

async function credentialRequest(operation: 'status' | 'save' | 'delete', key?: string): Promise<void> {
    const session = useState<SessionPayload | null>('auth-session', () => null).value?.session;
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
    Object.assign(connection, { connected: result.connected === true, available: result.available !== false, instance: result.instance === true });
}

export async function refreshOpenAiConnection(): Promise<void> {
    if (cloudMode()) await credentialRequest('status');
    else connection.connected = Boolean(await readLocalOpenAiKey());
}

export async function saveOpenAiKey(input: string): Promise<void> {
    const key = input.trim();
    if (!OPENAI_KEY_FORMAT.test(key)) throw new Error('Enter an OpenAI API key that starts with "sk-".');
    if (cloudMode()) return credentialRequest('save', key);
    try { await setKvByName(LOCAL_KEY, key); } catch { throw new Error('This browser could not save the key.'); }
    keyGeneration++;
    connection.connected = true;
}

export async function removeOpenAiKey(): Promise<void> {
    if (cloudMode()) return credentialRequest('delete');
    await hardDeleteKvByName(LOCAL_KEY);
    keyGeneration++;
    connection.connected = false;
}

/** Local mode forwards the device key to the OR3 server, for OpenAI models only. */
export async function openAiKeyHeaders(model: unknown): Promise<Record<string, string>> {
    if (cloudMode() || !isOpenAiModel(model)) return {};
    const key = await readLocalOpenAiKey();
    return key ? { 'x-or3-openai-key': key } : {};
}

export function useOpenAiKey() {
    return { connection: readonly(connection), refresh: refreshOpenAiConnection, save: saveOpenAiKey, remove: removeOpenAiKey };
}
