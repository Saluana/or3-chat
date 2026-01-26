import { z } from 'zod';
import type { WorkspaceSettingsStore } from '../stores/types';

const PluginsEnabledSchema = z.array(z.string()).default([]);

function safeJsonParse(raw: string): unknown | null {
    try {
        return JSON.parse(raw) as unknown;
    } catch {
        return null;
    }
}

export async function getEnabledPlugins(
    store: WorkspaceSettingsStore,
    workspaceId: string
): Promise<string[]> {
    const raw = await store.get(workspaceId, 'plugins.enabled');
    if (!raw) return [];
    const json = safeJsonParse(raw);
    if (json === null) return [];
    const parsed = PluginsEnabledSchema.safeParse(json);
    if (!parsed.success) return [];
    return parsed.data;
}

export async function setPluginEnabled(
    store: WorkspaceSettingsStore,
    workspaceId: string,
    pluginId: string,
    enabled: boolean
): Promise<string[]> {
    const current = await getEnabledPlugins(store, workspaceId);
    const next = new Set(current);
    if (enabled) {
        next.add(pluginId);
    } else {
        next.delete(pluginId);
    }
    const list = Array.from(next);
    await store.set(workspaceId, 'plugins.enabled', JSON.stringify(list));
    return list;
}

const SettingsSchema = z.record(z.string(), z.unknown()).default({});

export async function getPluginSettings(
    store: WorkspaceSettingsStore,
    workspaceId: string,
    pluginId: string
): Promise<Record<string, unknown>> {
    const raw = await store.get(workspaceId, `plugins.settings.${pluginId}`);
    if (!raw) return {};
    const json = safeJsonParse(raw);
    if (json === null) return {};
    const parsed = SettingsSchema.safeParse(json);
    if (!parsed.success) return {};
    return parsed.data;
}

export async function setPluginSettings(
    store: WorkspaceSettingsStore,
    workspaceId: string,
    pluginId: string,
    settings: Record<string, unknown>
): Promise<void> {
    const parsed = SettingsSchema.safeParse(settings);
    if (!parsed.success) {
        throw new Error('Invalid settings');
    }
    await store.set(
        workspaceId,
        `plugins.settings.${pluginId}`,
        JSON.stringify(parsed.data)
    );
}
