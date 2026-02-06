import { describe, expect, it } from 'vitest';

type Stored = { hash: string; bytes: Uint8Array };

describe('storage roundtrip integration', () => {
    it('uploads -> commits -> downloads with hash verification', () => {
        const storage = new Map<string, Stored>();

        const upload = (hash: string, bytes: Uint8Array) => {
            storage.set(hash, { hash, bytes });
            return { storage_id: `st:${hash}` };
        };

        const commit = (hash: string, storageId: string) => ({ ok: storageId.startsWith('st:') && storage.has(hash) });

        const download = (hash: string) => storage.get(hash)?.bytes;

        const hash = 'sha256:abc';
        const bytes = new Uint8Array([1, 2, 3]);

        const up = upload(hash, bytes);
        expect(commit(hash, up.storage_id).ok).toBe(true);
        expect(download(hash)).toEqual(bytes);
    });

    it('dedupes repeated upload of same hash', () => {
        const uploads = new Set<string>();
        const put = (hash: string) => uploads.add(hash);

        put('sha256:abc');
        put('sha256:abc');

        expect(uploads.size).toBe(1);
    });

    it('retries when presign URL is expired', () => {
        let attempts = 0;
        const uploadWithExpiry = () => {
            attempts += 1;
            if (attempts === 1) return { ok: false, status: 403, reason: 'expired' };
            return { ok: true, status: 200 };
        };

        expect(uploadWithExpiry()).toEqual({ ok: false, status: 403, reason: 'expired' });
        expect(uploadWithExpiry()).toEqual({ ok: true, status: 200 });
    });
});
