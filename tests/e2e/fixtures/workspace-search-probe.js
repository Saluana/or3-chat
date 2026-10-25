// Development-server performance fixture. Load with agent-browser eval --stdin
// or the named workspace-scale Playwright harness.
// Uses a disposable real IndexedDB database, never the active workspace.
(async () => {
    const { Or3DB } = await import('/_nuxt/db/client.ts');
    const { createChatPaletteSource } =
        await import('/_nuxt/core/search/command-palette/sources/chat-source.ts');
    const { PaletteSourceIndex } =
        await import('/_nuxt/core/search/command-palette/source-index.ts');
    const { readFamilyPage, readFamilyMembers } =
        await import('/_nuxt/utils/sidebar/thread-families.ts');
    const db = new Or3DB(`workspace-scale-${crypto.randomUUID()}`);
    let reads = [];
    db.use({
        stack: 'dbcore',
        name: 'scale-observation',
        create(down) {
            return {
                ...down,
                table(name) {
                    const table = down.table(name);
                    return {
                        ...table,
                        async query(request) {
                            const result = await table.query(request);
                            reads.push({
                                table: name,
                                rows: result.result.length,
                            });
                            return result;
                        },
                    };
                },
            };
        },
    });
    const context = {
        workspaceId: db.name,
        workspaceGeneration: 1,
        getDb: async () => db,
        canOpenNewPane: () => true,
    };
    let fixture;
    const base = { created_at: 1, updated_at: 1, deleted: false, clock: 1 };
    const tid = (index) => `thread-${String(index).padStart(6, '0')}`;
    const mid = (index, message) =>
        `${tid(index)}-m-${String(message).padStart(6, '0')}`;
    const source = createChatPaletteSource();
    // Exclude lazy dependency import/compilation from source and index timings.
    const warmIndex = new PaletteSourceIndex('warm');
    await warmIndex.replaceAll([]);
    warmIndex.dispose();
    const measure = async (action) => {
        reads = [];
        const longTasks = [];
        const observer = new PerformanceObserver((list) =>
            longTasks.push(...list.getEntries().map((entry) => entry.duration))
        );
        observer.observe({ type: 'longtask', buffered: false });
        let previous = performance.now(),
            maxHeartbeatGapMs = 0,
            ticks = 0;
        const heartbeat = setInterval(() => {
            const now = performance.now();
            maxHeartbeatGapMs = Math.max(maxHeartbeatGapMs, now - previous);
            previous = now;
            ticks++;
        }, 10);
        const started = performance.now();
        const value = await action();
        const durationMs = performance.now() - started;
        await new Promise((resolve) => setTimeout(resolve, 20));
        clearInterval(heartbeat);
        observer.disconnect();
        return {
            value,
            metrics: {
                durationMs,
                maxHeartbeatGapMs,
                ticks,
                longTasks,
                maxRowsPerRead: Math.max(0, ...reads.map((read) => read.rows)),
                readCount: reads.length,
                readRows: reads.reduce((sum, read) => sum + read.rows, 0),
            },
        };
    };
    window.__workspaceScale = {
        async seed(threadCount = 1000, longMessages = 5000) {
            await db.open();
            const started = performance.now();
            for (let start = 0; start < threadCount; start += 100) {
                const threads = [],
                    messages = [];
                for (
                    let index = start;
                    index < Math.min(threadCount, start + 100);
                    index++
                ) {
                    const branch = index > 0 && index % 50 === 0;
                    threads.push({
                        ...base,
                        id: tid(index),
                        title: `Workspace conversation ${index}`,
                        status: 'ready',
                        pinned: false,
                        forked: branch,
                        ...(branch
                            ? {
                                  branch_mode: 'reference',
                                  parent_thread_id: tid(index - 1),
                                  root_thread_id: tid(index - 1),
                                  anchor_message_id: mid(index - 1, 4),
                              }
                            : {}),
                    });
                    for (
                        let message = 0;
                        message < (index === 0 ? longMessages : 10);
                        message++
                    ) {
                        const role =
                            message % 5 === 4
                                ? 'tool'
                                : message % 2
                                  ? 'assistant'
                                  : 'user';
                        messages.push({
                            ...base,
                            id: mid(index, message),
                            thread_id: tid(index),
                            index: message,
                            role,
                            // Some legacy rows deliberately have no order_key.
                            ...(message % 3
                                ? {
                                      order_key: `${String(message).padStart(6, '0')}:fixture`,
                                  }
                                : {}),
                            data: {
                                content:
                                    `${index === threadCount - 1 && message === 8 ? 'tailneedle ' : ''}${index === 0 && message === longMessages - 2 ? 'longneedle ' : ''}Conversation ${index} message ${message}. ` +
                                    'ordinary searchable workspace text '.repeat(
                                        16
                                    ),
                                ...(role === 'tool' || message % 5 === 1
                                    ? {
                                          result: 'private-tool-payload '.repeat(
                                              400
                                          ),
                                      }
                                    : {}),
                            },
                        });
                    }
                }
                await db.transaction(
                    'rw',
                    db.threads,
                    db.messages,
                    async () => {
                        await db.threads.bulkPut(threads);
                        await db.messages.bulkPut(messages);
                    }
                );
            }
            fixture = {
                threads: threadCount,
                messages: (threadCount - 1) * 10 + longMessages,
                longConversationMessages: longMessages,
                seedMs: performance.now() - started,
            };
            return fixture;
        },
        async run() {
            const load = await measure(() => source.load(context));
            const resources = load.value;
            let digest = 2166136261,
                characters = 0;
            for (const resource of resources) {
                const body = `${resource.key}|${resource.content}|${resource.metadata?.messageCount}|${resource.metadata?.incomplete}`;
                characters += resource.content?.length ?? 0;
                for (let i = 0; i < body.length; i++)
                    digest = Math.imul(digest ^ body.charCodeAt(i), 16777619);
            }
            const index = new PaletteSourceIndex('chat');
            try {
                const build = await measure(() => index.replaceAll(resources));
                const queries = [];
                for (let i = 0; i < 10; i++) {
                    const started = performance.now();
                    const result = await index.search({
                        term: i % 2 ? 'longneedle' : 'tailneedle',
                        limit: 8,
                    });
                    queries.push({
                        durationMs: performance.now() - started,
                        ids: result.results.map((hit) => hit.recordId),
                        fallback: result.usingFallback,
                    });
                }
                const sidebar = await measure(() =>
                    readFamilyPage(db, { limit: 50, type: 'all', filter: {} })
                );
                const family = await measure(() =>
                    readFamilyMembers(db, tid(49), 50, {})
                );
                return {
                    fixture,
                    resources: resources.length,
                    characters,
                    digest: digest >>> 0,
                    source: load.metrics,
                    index: build.metrics,
                    queries,
                    sidebar: {
                        ...sidebar.metrics,
                        rows: sidebar.value.items.length,
                    },
                    expandedFamily: {
                        ...family.metrics,
                        rows: family.value.members.length,
                    },
                    approximateHeapBytes:
                        performance.memory?.usedJSHeapSize ?? null,
                };
            } finally {
                index.dispose();
            }
        },
        async abort() {
            const controller = new AbortController();
            const started = performance.now();
            setTimeout(() => controller.abort(), 0);
            try {
                await source.load({ ...context, signal: controller.signal });
                return { aborted: false };
            } catch (error) {
                return {
                    aborted: error.name === 'AbortError',
                    durationMs: performance.now() - started,
                };
            }
        },
        async close() {
            await db.delete();
            delete window.__workspaceScale;
            return 'disposed';
        },
    };
    return { ready: true, database: db.name };
})();
