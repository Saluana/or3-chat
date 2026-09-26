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

export interface PluginStorageMutationOptions {
    /** Write only when the current record has this revision. `null` means absent. */
    readonly ifRevision?: number | null;
}

export interface PluginStorageRecord<T extends PluginJsonValue = PluginJsonValue> {
    readonly value: T | null;
    readonly revision: number;
    readonly sizeBytes: number;
    readonly updatedAt: number;
}

export interface PluginStorageListEntry {
    readonly key: string;
    readonly sizeBytes: number;
    readonly updatedAt: number;
    readonly revision?: number;
}

export interface PluginStorageListOptions {
    readonly prefix?: string;
    /** Opaque cursor returned by the previous page. */
    readonly cursor?: string;
    readonly limit?: number;
}

export interface PluginStoragePage {
    readonly entries: readonly PluginStorageListEntry[];
    readonly nextCursor?: string;
}

export interface PluginStorageClient {
    get<T extends PluginJsonValue = PluginJsonValue>(key: string): Promise<PluginResult<T | null>>;
    getRecord<T extends PluginJsonValue = PluginJsonValue>(key: string): Promise<PluginResult<PluginStorageRecord<T>>>;
    set(key: string, value: PluginJsonValue, options?: PluginStorageMutationOptions): Promise<PluginResult<void>>;
    delete(key: string): Promise<PluginResult<void>>;
    list(prefix?: string): Promise<PluginResult<readonly PluginStorageListEntry[]>>;
    listPage(options?: PluginStorageListOptions): Promise<PluginResult<PluginStoragePage>>;
}
