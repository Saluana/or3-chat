artifact_id: 0c6c0a6c-5f30-4b4b-8a6e-1c9b2b90d8f0

## Tasks

1. Add Nitro server route with shared parsing: `/api/openrouter/stream`

-   [x] Create `server/api/openrouter/stream.post.ts`
    -   [x] Read JSON body; select API key = `process.env.OPENROUTER_API_KEY || body.apiKey` (Reqs: 1,4)
    -   [x] If no key, respond 400 with short message (Reqs: 1)
    -   [x] Proxy POST to OpenRouter with `Accept: text/event-stream` (Reqs: 2)
    -   [x] Use shared parser to convert upstream SSE into normalized `ORStreamEvent` and re-emit as SSE frames (Reqs: 6)
    -   [x] Abort upstream fetch on client disconnect (Reqs: 2)
    -   [x] Ensure no key is logged or echoed (Reqs: 4)

2. Extract isomorphic parser and minimal client wrapper tweak

-   [x] Extract parsing logic into shared module used by both server route and client fallback (Reqs: 6)
    -   [x] Update `openrouterStream` to call server first; on fallback, use shared parser locally (Reqs: 3,5,6)
    -   [x] Always include `apiKey` in the server request body; server uses it only if env key is missing (Reqs: 1,3)
    -   [x] Preserve existing `ORStreamEvent` shape (Reqs: 5,6)

3. Tests and sanity checks

-   [x] With env key: server emits normalized events; body apiKey ignored (Reqs: 1,6)
-   [x] Without env key: server uses body apiKey; streaming and abort work (Reqs: 1,2,6)
-   [x] No keys: 400; client fallback path still functions when direct is allowed (Reqs: 1,3)

4. Additional improvements

-   [x] Add smart server route detection with localStorage caching (static build detection)
-   [x] Remove all debug logging from server and client
