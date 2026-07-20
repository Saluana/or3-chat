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

export type PluginHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface PluginHttpRequest {
    readonly url: string;
    readonly method?: PluginHttpMethod;
    readonly headers?: Readonly<Record<string, string>>;
    readonly body?: PluginJsonValue | string;
    readonly timeoutMs?: number;
}

export interface PluginHttpResponse<T = PluginJsonValue> {
    readonly status: number;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: T;
}

export interface PluginHttpClient {
    request<T = PluginJsonValue>(
        request: PluginHttpRequest
    ): Promise<PluginResult<PluginHttpResponse<T>>>;
}
