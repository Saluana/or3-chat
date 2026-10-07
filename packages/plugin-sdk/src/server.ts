/** Dispatcher-authored route identity and reviewed server capabilities.
 * Trusted server packages run in the host process. Each service independently
 * enforces its grant and session; clients cannot manufacture this context. */
export interface PluginServerContext {
    readonly request: { readonly pluginId: string; readonly method: string; readonly routePath: string };
    readonly services: Readonly<Record<string, unknown>>;
}

export function getPluginServerContext(event: unknown): PluginServerContext {
    const context = (event as { context?: { or3PluginRequest?: PluginServerContext['request']; or3PluginServer?: PluginServerContext['services'] } } | null)?.context;
    if (!context?.or3PluginRequest || !context.or3PluginServer) {
        throw Object.assign(new Error('Plugin server capabilities unavailable'), { statusCode: 503 });
    }
    return { request: context.or3PluginRequest, services: context.or3PluginServer };
}
