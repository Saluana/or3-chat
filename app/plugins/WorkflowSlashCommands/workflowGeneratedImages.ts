import type { ModelGateway } from 'or3-workflow-core';
import { getDb } from '~/db/client';
import { createOrRefFile, changeRefCount } from '~/db/files';
import { getWriteTxTableNames, nowSec, nextClock } from '~/db/util';
import { dataUrlToBlob } from '~/utils/chat/files';
import { parseHashes } from '~/utils/files/attachments';
import {
    hasSupportedRasterBlobSignature,
    isSupportedRasterMimeType,
} from '~~/shared/files/file-kind';

/** Keep provider bytes out of workflow JSON; the normal message owns file references. */
export function withWorkflowGeneratedImages(
    gateway: ModelGateway,
    messageId: string,
): ModelGateway {
    const db = getDb();
    const assertCurrent = (signal?: AbortSignal) => {
        if (getDb() !== db || signal?.aborted)
            throw new Error(
                'Workflow image cancelled because its session is no longer active.',
            );
    };
    return {
        getModelCapabilities: (id) => gateway.getModelCapabilities(id),
        async generate(request) {
            assertCurrent(request.signal);
            const result = await gateway.generate(request);
            assertCurrent(request.signal);
            if (!result.images?.length) return result;
            if (result.images.length > 6)
                throw new Error(
                    'A workflow response may attach at most six generated images.',
                );
            const hashes: string[] = [];
            for (const image of result.images) {
                // Only inline raster output is accepted: no arbitrary remote URL fetches.
                if (image.url.length > 28 * 1024 * 1024)
                    throw new Error('Generated image exceeds the file limit.');
                const blob = dataUrlToBlob(image.url);
                if (
                    !blob ||
                    !isSupportedRasterMimeType(blob.type) ||
                    !(await hasSupportedRasterBlobSignature(blob, blob.type))
                ) {
                    throw new Error(
                        'Generated output is not a supported raster image.',
                    );
                }
                assertCurrent(request.signal);
                const meta = await createOrRefFile(
                    blob,
                    'workflow-generated-image',
                );
                try {
                    assertCurrent(request.signal);
                    await db.transaction(
                        'rw',
                        getWriteTxTableNames(db, ['messages', 'file_meta']),
                        async () => {
                            assertCurrent(request.signal);
                            const message = await db.messages.get(messageId);
                            if (!message || message.deleted)
                                throw new Error(
                                    'The workflow message is no longer available.',
                                );
                            const existing = parseHashes(message.file_hashes);
                            if (existing.includes(meta.hash)) {
                                await changeRefCount(meta.hash, -1, db);
                            } else {
                                if (existing.length >= 6)
                                    throw new Error(
                                        'A workflow message may attach at most six generated images.',
                                    );
                                await db.messages.put({
                                    ...message,
                                    file_hashes: JSON.stringify([
                                        ...existing,
                                        meta.hash,
                                    ]),
                                    updated_at: nowSec(),
                                    clock: nextClock(message.clock),
                                });
                            }
                        },
                    );
                } catch (error) {
                    await changeRefCount(meta.hash, -1, db);
                    throw error;
                }
                hashes.push(meta.hash);
            }
            const content = [
                result.content?.trim(),
                ...hashes.map(
                    (hash) => `Generated image attached (file-hash:${hash}).`,
                ),
            ]
                .filter(Boolean)
                .join('\n\n');
            return {
                ...result,
                images: undefined,
                content,
                assistantMessage: { ...result.assistantMessage, content },
            };
        },
    };
}
