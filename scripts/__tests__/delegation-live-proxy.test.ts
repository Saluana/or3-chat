import { expect, it, vi } from 'vitest';
import { createDelegationLiveProxy } from '../test/delegation-live-proxy';

const target = 'http://localhost/api/v1/chat/completions';
const parent = { model: 'provider/model', stream: true, max_tokens: 5000, max_completion_tokens: 10000,
    n: 10, models: ['other/model'], route: 'fallback', plugins: [{ id: 'web' }],
    messages: [{ role: 'user', content: 'Ask a child for JADE ORCHID' }],
    tools: [{ function: { name: 'delegate_chat' } }] };
const child = { model: 'provider/model', stream: true, messages: [{ role: 'user', content: 'JADE ORCHID' }] };
function request(body: unknown, token = 'test-token') {
    return new Request(target, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
}

it('holds child requests until release and forwards only permitted bounded requests', async () => {
    const forward = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response('data: done\n\n', { headers: { 'content-type': 'text/event-stream' } }));
    const proxy = createDelegationLiveProxy({ apiKey: 'secret-key', proxyToken: 'test-token', models: ['provider/model'], forward });
    expect((await proxy.handle(request(parent, 'wrong'))).status).toBe(401);
    expect((await proxy.handle(request({ ...parent, model: 'other/model' }))).status).toBe(403);
    expect((await proxy.handle(request({ ...child, messages: [{ role: 'user', content: 'different' }] }))).status).toBe(403);
    expect(forward).not.toHaveBeenCalled();
    expect((await proxy.handle(request(parent))).status).toBe(200);
    const pending = proxy.handle(request(child));
    await vi.waitFor(() => expect(proxy.snapshot().childStarted).toBe(1));
    expect(forward).toHaveBeenCalledOnce();
    proxy.release();
    expect((await pending).status).toBe(200);
    expect(proxy.snapshot().requests).toEqual(['parent', 'child']);
    const [url, init] = forward.mock.calls[0]!;
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(init?.headers).toEqual({ authorization: 'Bearer secret-key', 'content-type': 'application/json' });
    expect(JSON.parse(String(init?.body)).max_tokens).toBe(512);
    expect(JSON.parse(String(init?.body)).n).toBe(1);
    expect(JSON.parse(String(init?.body))).not.toHaveProperty('max_completion_tokens');
    expect(JSON.parse(String(init?.body))).not.toHaveProperty('models');
    expect(JSON.parse(String(init?.body))).not.toHaveProperty('route');
    expect(JSON.parse(String(init?.body))).not.toHaveProperty('plugins');
    for (let index = 0; index < 6; index++) expect((await proxy.handle(request(parent))).status).toBe(200);
    expect((await proxy.handle(request(parent))).status).toBe(403);
    expect(forward).toHaveBeenCalledTimes(8);
});
