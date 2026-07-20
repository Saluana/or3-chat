import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('useOr3NetPreviewPaneState', () => {
    beforeEach(async () => {
        vi.resetModules();
        const { useOr3NetPreviewPaneState } = await import('../useOr3NetPreviewPaneState');
        useOr3NetPreviewPaneState().clearAll();
    });

    it('shares records across composable instances without polluting globalThis', async () => {
        const { useOr3NetPreviewPaneState } = await import('../useOr3NetPreviewPaneState');
        const first = useOr3NetPreviewPaneState();
        const second = useOr3NetPreviewPaneState();

        const record = first.remember({
            preview: {
                preview_id: 'preview-1',
                workspace_id: 'ws-1',
                kind: 'static-site',
                delivery_mode: 'embedded',
                source_type: 'files',
                status: 'ready',
                entry_path: '/index.html',
                path: '/index.html',
                service_id: 'service-1',
                supports_iframe: true,
                supports_new_tab: true,
            },
            launch: {
                preview_id: 'preview-1',
                workspace_id: 'ws-1',
                launch_url: 'https://preview.test/launch',
                embed_url: 'https://preview.test/embed',
                delivery_mode: 'embedded',
                supports_iframe: true,
                supports_new_tab: true,
                reused_tunnel: false,
                service_status: 'ready',
                expires_at: '2026-04-01T01:00:00.000Z',
            },
        });

        expect(second.get(record.id)?.preview_id).toBe('preview-1');
        expect(second.records.value.size).toBe(1);
        expect('__or3NetPreviewPaneRecords' in globalThis).toBe(false);
    });
});
