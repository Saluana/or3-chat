artifact_id: 8d8d1878-2e5d-43bd-8d6b-6a4d2a9bc0b3
content_type: text/markdown

# tasks.md

1. Plugin Bootstrap

-   [ ] Create `app/plugins/supabase-sync.client.ts` that registers on client init and loads Supabase + hook bus instances. (Requirements: 1.1, 1.2, 6.1)
-   [ ] Implement session watcher to start/stop the engine when auth state changes. (Requirements: 1.2, 1.3)
-   [ ] Register dispose handler for HMR and sign-out to tear down subscriptions. (Requirements: 1.3)

2. Topic Configuration

-   [ ] Define `app/config/sync-topics.ts` with table-to-adapter mappings consumable by the engine. (Requirements: 2.1)
-   [ ] Load the config through the plugin and ensure opt-in for new tables requires config only. (Requirements: 2.3)

3. Provider Abstraction

-   [ ] Define a `SyncProvider` interface and handler callbacks covering subscribe, unsubscribe, and batched push operations. (Requirements: 7.1)
-   [ ] Implement `createSupabaseProvider` as the default factory bound to Supabase client utilities. (Requirements: 7.1)
-   [ ] Expose provider selection through plugin options so swapping providers only changes the factory. (Requirements: 7.2, 7.3)
-   [ ] Document provider option shape and example usage for alternate backends. (Requirements: 7.2)

4. Realtime Inbound Sync

-   [ ] Build subscription manager that attaches to Supabase realtime channels for each topic. (Requirements: 2.2)
-   [ ] Route payloads through adapters to update local stores with `toLocal` + `applyLocal`. (Requirements: 3.1)
-   [ ] Handle delete events by invoking adapter `deleteLocal`. (Requirements: 3.3)
-   [ ] Emit `sync:error` hook events on transformer failures without crashing. (Requirements: 3.2)

5. Outbound Queue

-   [ ] Wire hook bridge to capture `db:*:mutated` events and enqueue diffs. (Requirements: 4.1)
-   [ ] Implement batching with configurable 250ms window before flushing to Supabase. (Requirements: 4.2)
-   [ ] Add retry logic with exponential backoff and `sync:retry` events. (Requirements: 4.3)

6. Offline Resilience

-   [ ] Persist outbound queue items in IndexedDB with size accounting. (Requirements: 5.1, 5.3)
-   [ ] Listen to connectivity changes and flush backlog in order once online. (Requirements: 5.2)

7. Transparency & Metrics

-   [ ] Suppress production console logs while emitting `sync:stats` metrics through hooks. (Requirements: 6.3)
-   [ ] Confirm no UI components or direct DOM interactions are introduced. (Requirements: 6.1)
-   [ ] Add lightweight CPU usage sampling or guard rails to maintain performance budget. (Requirements: 6.2)

8. Testing & Verification

-   [ ] Author unit tests for adapters, queue overflow, and retry helper utilities. (Requirements: Non-functional Testability)
-   [ ] Create integration test harness mocking Supabase client to validate inbound/outbound flow. (Requirements: 1.1–5.3)
-   [ ] Document manual test steps for offline/online transitions and multi-tab reconciliation. (Requirements: 6.1, 6.2)
