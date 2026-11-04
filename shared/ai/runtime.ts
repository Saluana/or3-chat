/** Client-supplied router identity, endpoint or credentials are never honored. */
const ROUTER_CONFIGURATION_KEYS = ['router', 'routerId', 'router_id', 'endpoint', 'baseUrl', 'base_url', 'url', 'apiKey', 'api_key'];

export function hasRouterConfiguration(input: object): boolean {
    return ROUTER_CONFIGURATION_KEYS.some(key => Object.hasOwn(input, key));
}

/** A router owns preparation and decoding; the host owns authorized I/O. */
export interface AiAdapter<Request, Prepared, Event, Completion = never> {
    readonly id: string;
    prepare(request: Request): Prepared | Promise<Prepared>;
    decodeStream?(response: Response, prepared: Prepared): AsyncIterable<Event>;
    decodeCompletion?(response: Response, prepared: Prepared): Promise<Completion>;
}

export function createAiRuntime<Request, Prepared, Event, Completion = never>(
    adapter: AiAdapter<Request, Prepared, Event, Completion>,
    open: (prepared: Prepared) => Promise<Response>
) {
    async function* streamPrepared(prepared: Prepared): AsyncGenerator<Event> {
        if (!adapter.decodeStream) throw new Error('Router does not support streaming');
        const response = await open(prepared);
        yield* adapter.decodeStream(response, prepared);
    }

    return {
        prepare: (request: Request) => adapter.prepare(request),
        // Raw response ownership stays with the caller (for example, an SSE proxy).
        openPrepared: open,
        streamPrepared,
        async *stream(request: Request): AsyncGenerator<Event> {
            yield* streamPrepared(await adapter.prepare(request));
        },
        async complete(request: Request): Promise<Completion> {
            if (!adapter.decodeCompletion) throw new Error('Router does not support completions');
            const prepared = await adapter.prepare(request);
            return adapter.decodeCompletion(await open(prepared), prepared);
        },
    };
}
