import type { ToolCardBinding } from '~/composables/chat/tool-cards';
import { verifyServedModuleBytes } from '~~/shared/plugins/isolation/portable-bootstrap';
import { utf8Bytes } from '~~/shared/chat/tool-card-data';
const cache = new Map<string, Promise<{ module: ArrayBuffer; stylesheet?: string }>>();
export async function loadToolCardBundle(
    source: Extract<ToolCardBinding['source'], { kind: 'frame' }>
) {
    const key =
        source.pluginId +
        ':' +
        source.packageDigest +
        ':' +
        source.card.id +
        ':' +
        source.card.entrySha256;
    let bundle = cache.get(key);
    if (!bundle) {
        bundle = (async () => {
            const base =
                '/api/plugins/packages/' +
                encodeURIComponent(source.pluginId) +
                '/' +
                encodeURIComponent(source.packageDigest) +
                '/';
            const read = async (
                path: string,
                digest: typeof source.card.entrySha256
            ) => {
                const result = await verifyServedModuleBytes({
                    url: base + path.split('/').map(encodeURIComponent).join('/'),
                    expectedDigest: digest,
                    load: async (url) => {
                        const response = await fetch(url, {
                            credentials: 'same-origin',
                            cache: 'no-store'
                        });
                        if (!response.ok) throw new Error('bundle-unavailable');
                        const declared = Number(response.headers.get('content-length'));
                        if (declared > 1536 * 1024)
                            throw new Error('bundle-unavailable');
                        const reader = response.body?.getReader();
                        if (!reader) throw new Error('bundle-unavailable');
                        const chunks: Uint8Array[] = [];
                        let size = 0;
                        while (true) {
                            const next = await reader.read();
                            if (next.done) break;
                            size += next.value.byteLength;
                            if (size > 1536 * 1024) {
                                await reader.cancel();
                                throw new Error('bundle-unavailable');
                            }
                            chunks.push(next.value);
                        }
                        const bytes = new Uint8Array(size);
                        let offset = 0;
                        for (const chunk of chunks) {
                            bytes.set(chunk, offset);
                            offset += chunk.byteLength;
                        }
                        return { bytes: bytes.buffer };
                    }
                });
                if (result.status !== 'verified') throw new Error('bundle-unavailable');
                return result.source;
            };
            const code = await read(source.card.entry, source.card.entrySha256);
            const stylesheet = source.card.stylesheet
                ? await read(source.card.stylesheet.path, source.card.stylesheet.sha256)
                : undefined;
            if (utf8Bytes(code) + utf8Bytes(stylesheet ?? '') > 1536 * 1024)
                throw new Error('bundle-unavailable');
            return {
                module: new TextEncoder().encode(code).buffer,
                stylesheet
            };
        })();
        cache.set(key, bundle);
        if (cache.size > 24) cache.delete(cache.keys().next().value!);
        void bundle.catch(() => cache.delete(key));
    }
    const value = await bundle;
    return { ...value, module: value.module.slice(0) };
}
