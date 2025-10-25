artifact_id: 0c6c0a6c-5f30-4b4b-8a6e-1c9b2b90d8f0

## Tasks

1. Add Nitro server route with shared parsing: `/api/openrouter/stream`

-   [ ] Create `server/api/openrouter/stream.post.ts`
    -   [ ] Read JSON body; select API key = `process.env.OPENROUTER_API_KEY || body.apiKey` (Reqs: 1,4)
    -   [ ] If no key, respond 400 with short message (Reqs: 1)
    -   [ ] Proxy POST to OpenRouter with `Accept: text/event-stream` (Reqs: 2)
    -   [ ] Use shared parser to convert upstream SSE into normalized `ORStreamEvent` and re-emit as SSE frames (Reqs: 6)
    -   [ ] Abort upstream fetch on client disconnect (Reqs: 2)
    -   [ ] Ensure no key is logged or echoed (Reqs: 4)

2. Extract isomorphic parser and minimal client wrapper tweak

-   [ ] Extract parsing logic into shared module used by both server route and client fallback (Reqs: 6)
    -   [ ] Update `openrouterStream` to call server first; on fallback, use shared parser locally (Reqs: 3,5,6)
    -   [ ] Always include `apiKey` in the server request body; server uses it only if env key is missing (Reqs: 1,3)
    -   [ ] Preserve existing `ORStreamEvent` shape (Reqs: 5,6)

3. Tests and sanity checks

-   [ ] With env key: server emits normalized events; body apiKey ignored (Reqs: 1,6)
-   [ ] Without env key: server uses body apiKey; streaming and abort work (Reqs: 1,2,6)
-   [ ] No keys: 400; client fallback path still functions when direct is allowed (Reqs: 1,3)
