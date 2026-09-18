import type { PluginResult } from './results';

export type PluginJsonValue =
    | null
    | boolean
    | number
    | string
    | readonly PluginJsonValue[]
    | { readonly [key: string]: PluginJsonValue };

export interface PluginSettingsClient {
    get<T extends PluginJsonValue = PluginJsonValue>(key: string): Promise<PluginResult<T | null>>;
    list(): Promise<PluginResult<Readonly<Record<string, PluginJsonValue>>>>;
    set(key: string, value: PluginJsonValue): Promise<PluginResult<void>>;
    delete(key: string): Promise<PluginResult<void>>;
}

export interface PluginStorageListEntry {
    readonly key: string;
    readonly sizeBytes: number;
    readonly updatedAt: number;
}

export interface PluginStorageClient {
    get<T extends PluginJsonValue = PluginJsonValue>(key: string): Promise<PluginResult<T | null>>;
    set(key: string, value: PluginJsonValue): Promise<PluginResult<void>>;
    delete(key: string): Promise<PluginResult<void>>;
    list(prefix?: string): Promise<PluginResult<readonly PluginStorageListEntry[]>>;
}
