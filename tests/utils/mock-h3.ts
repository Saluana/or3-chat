import type { H3Event } from 'h3';

interface CreateMockH3EventInput {
    method?: string;
    path?: string;
    query?: Record<string, string | string[] | undefined>;
}

export function createMockH3Event(input: CreateMockH3EventInput = {}): H3Event {
    const method = input.method ?? 'GET';
    const path = input.path ?? '/';
    const query = input.query ?? {};

    const [pathname, search = ''] = path.split('?');
    const urlSearchParams = new URLSearchParams(search);
    for (const [key, value] of Object.entries(query)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
            for (const entry of value) urlSearchParams.append(key, entry);
            continue;
        }
        urlSearchParams.set(key, value);
    }

    const req = {
        method,
        headers: {},
        url: pathname + (urlSearchParams.toString() ? `?${urlSearchParams.toString()}` : ''),
    };

    return {
        node: {
            req,
            res: {},
        },
        context: {},
        method,
        path: pathname,
    } as unknown as H3Event;
}
