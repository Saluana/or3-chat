import { describe, expect, it, vi } from 'vitest';
import { createExternalAgentStagingBridge } from '../external-agent-staging-bridge';

const host = { id: 'local-intern', baseUrl: 'http://127.0.0.1:9100' };
const file = { id: 'file-1', kind: 'text' as const, name: 'notes.md', mimeType: 'text/markdown', sizeBytes: 7, data: new Blob(['# notes']) };

describe('External Agent staging bridge', () => {
    it('uploads into one workspace batch and releases that exact batch', async () => {
        const requests: Array<{ path: string; init?: RequestInit }> = [];
        const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const path = new URL(String(input)).pathname;
            requests.push({ path, init });
            if (path.endsWith('/roots')) return Response.json({ items: [{ id: 'workspace', writable: true }] });
            if (path.endsWith('/mkdir')) return Response.json({});
            if (path.endsWith('/upload')) {
                const form = init?.body as FormData;
                expect(form.get('root_id')).toBe('workspace');
                expect(form.get('file')).toBeInstanceOf(Blob);
                return Response.json({ root_id: 'workspace', path: `${form.get('path')}/notes.md` });
            }
            if (path.endsWith('/release')) return Response.json({});
            throw new Error(`Unexpected request ${path}`);
        });
        const staging = createExternalAgentStagingBridge(fetch);
        const staged = await staging.stageFiles(host, 'token-1', [file]);
        expect(staged).toHaveLength(1);
        expect(staged[0]).toMatchObject({ source: 'workspace_ref', root_id: 'workspace', name: 'notes.md' });
        expect(staged[0]?.path).toMatch(/^\.or3-upload-[0-9]{10,}-[a-z0-9]{6}\/notes\.md$/);
        expect(await staging.releaseStagedFiles(host, 'token-1', staged)).toEqual({ status: 'released' });
        expect(requests.map((request) => request.path)).toEqual([
            '/internal/v1/files/roots', '/internal/v1/files/mkdir',
            '/internal/v1/files/upload', '/internal/v1/files/staging/release',
        ]);
        expect(requests.every((request) => new Headers(request.init?.headers).get('Authorization') === 'Bearer token-1')).toBe(true);
    });

    it('rejects a hostile returned path and cleans the created batch', async () => {
        const paths: string[] = [];
        const fetch = vi.fn(async (input: RequestInfo | URL) => {
            const path = new URL(String(input)).pathname;
            paths.push(path);
            if (path.endsWith('/roots')) return Response.json({ items: [{ id: 'workspace', writable: true }] });
            if (path.endsWith('/mkdir')) return Response.json({});
            if (path.endsWith('/upload')) return Response.json({ root_id: 'workspace', path: '../escape/notes.md' });
            if (path.endsWith('/release')) return Response.json({});
            throw new Error(`Unexpected request ${path}`);
        });
        const staging = createExternalAgentStagingBridge(fetch);
        await expect(staging.stageFiles(host, 'token-1', [file])).rejects.toThrow('unsafe attachment path');
        expect(paths.at(-1)).toBe('/internal/v1/files/staging/release');
    });
});
