import { getCachedSessionContext } from '~/composables/auth/useSessionContext';
import { captureChatMediaScope } from '~/utils/chat/media-scope';
import { computeHashHex } from '~/utils/hash';
import type { OpenRouterRequestBody } from './openrouter-request';

const MIN_REFERENCE_BYTES = 32 * 1024;
const MAX_REFERENCE_BYTES = 16 * 1024 * 1024;
const MAX_REFERENCES = 32;

/** Replace only preflight-confirmed, locally hydrated originals on the Cloud route. */
export async function prepareCloudAttachmentReferences(body: OpenRouterRequestBody, signal?: AbortSignal,
    storage?: { enabled?: boolean; provider?: string }): Promise<OpenRouterRequestBody> {
    if (!storage?.enabled || storage.provider !== 'fs') return body;
    const session = getCachedSessionContext();
    if (!session?.authenticated || !session.user?.id || !session.workspace?.id || typeof atob !== 'function') return body;
    if (!body.messages.some(message => Array.isArray(message.content) && message.content.some(part =>
        part.type === 'image_url' || part.type === 'file'))) return body;
    const scope = captureChatMediaScope(undefined, signal);
    const workspaceId = session.workspace.id;
    const candidates: Array<{ messageIndex: number; partIndex: number; hash: string; storageId: string; mime: string; size: number; prefix: string }> = [];
    for (const [messageIndex, message] of body.messages.entries()) {
        if (!Array.isArray(message.content)) continue;
        for (const [partIndex, part] of message.content.entries()) {
            const value = part.type === 'image_url' && typeof part.image_url === 'object' && part.image_url
                ? (part.image_url as { url?: unknown }).url
                : part.type === 'file' && typeof part.file === 'object' && part.file
                    ? (part.file as { file_data?: unknown }).file_data : undefined;
            if (typeof value !== 'string') continue;
            const match = /^(data:(image\/(?:png|jpeg|webp|gif)|application\/pdf);base64,)([a-zA-Z0-9+/]+={0,2})$/.exec(value);
            if (!match || candidates.length >= MAX_REFERENCES || match[3]!.length < 4 * Math.ceil(MIN_REFERENCE_BYTES / 3) || match[3]!.length > 4 * Math.ceil(MAX_REFERENCE_BYTES / 3)) continue;
            const mime = match[2]!;
            if ((part.type === 'image_url') !== mime.startsWith('image/')) continue;
            try {
                const decoded = atob(match[3]!);
                if (decoded.length < MIN_REFERENCE_BYTES || decoded.length > MAX_REFERENCE_BYTES) continue;
                const bytes = new Uint8Array(decoded.length);
                for (let index = 0; index < decoded.length; index++) bytes[index] = decoded.charCodeAt(index);
                const hash = `sha256:${await computeHashHex(new Blob([bytes]), 'sha256')}`;
                scope.assertCurrent();
                const meta = await scope.db.file_meta.get(hash);
                scope.assertCurrent();
                if (!meta || meta.deleted || meta.storage_provider_id !== 'fs' || meta.storage_id !== `${workspaceId}:${hash}` ||
                    meta.size_bytes !== bytes.length || meta.mime_type.toLowerCase().split(';', 1)[0]?.trim() !== mime ||
                    meta.kind !== (mime.startsWith('image/') ? 'image' : 'pdf')) continue;
                candidates.push({ messageIndex, partIndex, hash, storageId: meta.storage_id, mime, size: bytes.length, prefix: match[1]! });
            } catch (error) {
                scope.assertCurrent();
                if (signal?.aborted) throw error;
                // Unavailable local metadata or unsupported data stays inline.
            }
        }
    }
    if (!candidates.length) return body;
    scope.assertCurrent();
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(), 3000);
    let eligible: number[] = [];
    try {
        const response = await fetch('/api/storage/chat-attachment-capability', { method: 'POST', credentials: 'include', signal: controller.signal,
            headers: { 'content-type': 'application/json', 'x-or3-cloud-intent': 'mutation' },
            body: JSON.stringify({ files: candidates.map(({ hash, storageId, mime, size }) => ({ hash, storageId, mime, size })) }) });
        if (response.ok) {
            const result: unknown = await response.json();
            if (result && typeof result === 'object' && (result as { version?: unknown }).version === 1 &&
                (result as { workspaceId?: unknown }).workspaceId === workspaceId && Array.isArray((result as { eligible?: unknown }).eligible)) {
                eligible = (result as { eligible: unknown[] }).eligible.filter((index): index is number => Number.isSafeInteger(index) && typeof index === 'number' && index >= 0 && index < candidates.length);
            }
        }
    } catch (error) {
        if (signal?.aborted) throw error;
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
    }
    scope.assertCurrent();
    if (!eligible.length) return body;
    // Copy only the message paths being changed. Serializing the whole request
    // here would duplicate every large inline attachment before removing it.
    const copy = { ...body, messages: [...body.messages], _cloudAttachments: [] as unknown[] };
    for (const candidateIndex of new Set(eligible)) {
        const candidate = candidates[candidateIndex]!;
        const content = copy.messages[candidate.messageIndex]?.content;
        if (!Array.isArray(content)) continue;
        const part = content[candidate.partIndex];
        if (!part) continue;
        const placeholder = `or3-cloud-attachment:${copy._cloudAttachments.length}`;
        const nextContent = [...content];
        if (part.type === 'image_url' && part.image_url && typeof part.image_url === 'object') {
            nextContent[candidate.partIndex] = { ...part, image_url: { ...part.image_url, url: placeholder } };
        } else if (part.type === 'file' && part.file && typeof part.file === 'object') {
            nextContent[candidate.partIndex] = { ...part, file: { ...part.file, file_data: placeholder } };
        } else continue;
        copy.messages[candidate.messageIndex] = { ...copy.messages[candidate.messageIndex]!, content: nextContent };
        copy._cloudAttachments.push({ messageIndex: candidate.messageIndex, partIndex: candidate.partIndex,
            hash: candidate.hash, storageId: candidate.storageId, prefix: candidate.prefix });
    }
    return copy._cloudAttachments.length ? copy : body;
}
