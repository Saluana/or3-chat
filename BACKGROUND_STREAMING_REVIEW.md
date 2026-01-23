# Code Review: Background Streaming

1. **Verdict**
   High

2. **Executive summary**
   * **Broken Notification Architecture**: Notifications rely on client-side polling within `useChat`, meaning users only get notified if they happen to open the specific thread. Global background notifications (Phase 7) are effectively missing.
   * **Dangerous Import**: `require` is used in `store.ts`, which breaks ESM compatibility in Bun/Nuxt.
   * **Missing Server Logic**: The server does not emit notifications to the `notifications` table as per the design doc, causing the gap in functionality.
   * **Testing Gap**: No unit or integration tests exist for the new providers, despite the complexity of the feature.

3. **Findings**

   * **Title**: `require` usage breaks ESM
   * **Severity**: High
   * **Evidence**: `server/utils/background-jobs/store.ts` lines 29-31
     ```typescript
     const { convexJobProvider } = require('./providers/convex') as {
         convexJobProvider: BackgroundJobProvider;
     };
     ```
   * **Why**: `require` is not supported in pure ESM environments (like Bun/Nuxt in certain modes). This will crash the server at runtime if the branch is taken.
   * **Fix**: Use dynamic `import()`.
     ```typescript
     const { convexJobProvider } = await import('./providers/convex');
     cachedProvider = convexJobProvider;
     ```
     (Note: `getJobProvider` will need to become async or handle the promise).
   * **Tests**: `server/utils/background-jobs/store.test.ts` (create it)

   * **Title**: Server-side notification emission missing
   * **Severity**: High
   * **Evidence**: `server/utils/background-jobs/stream-handler.ts` line 147
     ```typescript
     // Notifications are emitted client-side when background jobs complete.
     ```
   * **Why**: Contradicts design doc and `tasks.md`. If the user closes the tab, the client-side poll dies. When they return, they get no notification until they manually navigate to the thread. This defeats the purpose of "background" notifications.
   * **Fix**: Implement `emitBackgroundComplete` on the server (writing to `notifications` table in Convex).
   * **Tests**: Integration test verifying `notifications` table entry after job completion.

   * **Title**: Client-side polling scoped to active thread
   * **Severity**: Medium
   * **Evidence**: `app/composables/chat/useAi.ts`
   * **Why**: `pollBackgroundJob` is only triggered when `useChat` initializes or receives a message. If a user navigates to the home page or another thread, they stop receiving updates for the background job.
   * **Fix**: Introduce a global `useBackgroundJobs` composable in `app.vue` or a plugin that polls/syncs active jobs regardless of the current route.

   * **Title**: Circular dependency risk in Memory Provider cleanup
   * **Severity**: Low
   * **Evidence**: `server/utils/background-jobs/providers/memory.ts` line 20
     ```typescript
     memoryProvider.cleanupExpired();
     ```
   * **Why**: Relying on the exported variable inside its own definition's closure is brittle.
   * **Fix**: Extract `cleanupExpired` logic to a standalone function and call that.

4. **Diffs and examples**

   **Fixing `getJobProvider` (Async)**

   ```typescript
   // server/utils/background-jobs/store.ts

   // ... imports

   let cachedProvider: BackgroundJobProvider | null = null;

   export async function getJobProvider(): Promise<BackgroundJobProvider> {
       if (cachedProvider) return cachedProvider;

       const config = useRuntimeConfig();
       const storageProvider = config.backgroundJobs?.storageProvider ?? 'memory';

       if (storageProvider === 'convex' && config.public.sync.convexUrl) {
           const { convexJobProvider } = await import('./providers/convex');
           cachedProvider = convexJobProvider;
       } else {
           cachedProvider = memoryJobProvider;
       }

       return cachedProvider;
   }
   ```
   *(Note: This requires updating call sites to `await getJobProvider()`)*

   **Server-side Notification (Conceptual)**

   ```typescript
   // server/utils/notifications/emit.ts
   import { api } from '~~/convex/_generated/api';

   export async function emitBackgroundComplete(jobId: string, userId: string, threadId: string) {
       const client = new ConvexHttpClient(useRuntimeConfig().public.sync.convexUrl);
       // Push to notifications table
       await client.mutation(api.notifications.create, {
           targetUserId: userId,
           type: 'ai.background.complete',
           threadId,
           jobId
       });
   }
   ```

5. **Performance notes**
   * Polling in `useAi.ts` is currently 1000ms. If we move to a global poller, ensure it batches checks or uses a single "active jobs" query to avoid N requests for N jobs.

6. **Deletions**
   * Remove client-side `emitBackgroundComplete` in `useAi.ts` once server-side is implemented, to avoid duplicate notifications (or guard it).

7. **Checklist for merge**
   * [ ] Convert `getJobProvider` to async and fix `require`.
   * [ ] Implement server-side notification emission.
   * [ ] Add unit tests for `MemoryProvider`.
   * [ ] Add integration test for background stream flow.
