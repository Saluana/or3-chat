import { readonly, ref } from 'vue';

import type { Or3NetLaunchMetadata, Or3NetPreviewDescriptor } from './types';

export interface Or3NetPreviewPaneRecord {
    id: string;
    preview_id: string;
    workspace_id: string;
    title: string;
    kind: Or3NetPreviewDescriptor['kind'];
    source_type: Or3NetPreviewDescriptor['source_type'];
    launch_url: string;
    embed_url: string | null;
    delivery_mode: Or3NetLaunchMetadata['delivery_mode'];
    supports_iframe: boolean;
    supports_new_tab: boolean;
    service_status: Or3NetLaunchMetadata['service_status'];
    expires_at: string;
}

const registry = new Map<string, Or3NetPreviewPaneRecord>();

const records = ref(new Map(registry));

function syncRecords(): void {
    records.value = new Map(registry);
}

function createPreviewPaneRecordId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }

    return `or3-net-preview-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function useOr3NetPreviewPaneState() {
    function remember(input: {
        preview: Or3NetPreviewDescriptor;
        launch: Or3NetLaunchMetadata;
    }): Or3NetPreviewPaneRecord {
        const record: Or3NetPreviewPaneRecord = {
            id: createPreviewPaneRecordId(),
            preview_id: input.preview.preview_id,
            workspace_id: input.preview.workspace_id,
            title:
                input.preview.entry_path ??
                input.preview.service_id ??
                input.preview.path ??
                input.preview.preview_id,
            kind: input.preview.kind,
            source_type: input.preview.source_type,
            launch_url: input.launch.launch_url,
            embed_url:
                input.launch.embed_url ??
                (input.launch.supports_iframe ? input.launch.launch_url : null),
            delivery_mode: input.launch.delivery_mode,
            supports_iframe: input.launch.supports_iframe,
            supports_new_tab: input.launch.supports_new_tab,
            service_status: input.launch.service_status,
            expires_at: input.launch.expires_at,
        };

        registry.set(record.id, record);
        syncRecords();
        return record;
    }

    function get(recordId: string | null | undefined): Or3NetPreviewPaneRecord | null {
        if (!recordId) return null;
        return registry.get(recordId) ?? null;
    }

    function update(
        recordId: string,
        patch: Partial<Omit<Or3NetPreviewPaneRecord, 'id' | 'preview_id' | 'workspace_id'>>
    ): Or3NetPreviewPaneRecord | null {
        const current = registry.get(recordId);
        if (!current) {
            return null;
        }

        const next = { ...current, ...patch };
        registry.set(recordId, next);
        syncRecords();
        return next;
    }

    function remove(recordId: string): void {
        registry.delete(recordId);
        syncRecords();
    }

    function clearWorkspace(workspaceId: string): void {
        let removed = false;
        for (const [recordId, record] of registry.entries()) {
            if (record.workspace_id !== workspaceId) {
                continue;
            }
            registry.delete(recordId);
            removed = true;
        }
        if (removed) {
            syncRecords();
        }
    }

    function clearAll(): void {
        if (registry.size === 0) {
            return;
        }
        registry.clear();
        syncRecords();
    }

    return {
        records: readonly(records),
        remember,
        get,
        update,
        remove,
        clearWorkspace,
        clearAll,
    };
}
