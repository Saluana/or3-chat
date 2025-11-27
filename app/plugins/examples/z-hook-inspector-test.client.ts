import type { HookEngine } from '~/core/hooks/hooks';

export default defineNuxtPlugin(() => {
    // Access the global hooks instance (created by hooks.client.ts plugin)
    const g = globalThis as any;
    const hooks = g.__NUXT_HOOKS__ as HookEngine;

    if (!hooks) {
        console.error(
            '[HookInspectorTest] ❌ Hooks engine not available - plugin may have loaded too early'
        );
        return;
    }

    console.log(
        '[HookInspectorTest] ✅ Plugin initialized, hooks engine available'
    );

    // Register some test hooks that fire on different events

    // 1. Fire hooks every 2 seconds to show activity
    let counter = 0;
    setInterval(() => {
        counter++;
        hooks.doAction('test.inspector.tick', { count: counter });

        // Every 3rd tick, also fire a filter
        if (counter % 3 === 0) {
            hooks.applyFilters('test.inspector.filter', `tick-${counter}`);
        }

        // Every 5th tick, simulate an error
        if (counter % 5 === 0) {
            hooks.doAction('test.inspector.error', { count: counter });
        }
    }, 2000);

    // 2. Listen to some real app hooks to show actual activity
    hooks.on('ui.pane.switch:action', (payload: any) => {
        console.log('[HookInspectorTest] Pane switched to', payload?.index);
    });

    hooks.on('ui.sidebar.select:action:before', (info: any) => {
        console.log('[HookInspectorTest] Sidebar selection:', info);
    });

    // 3. Register the error-throwing hook
    hooks.on('test.inspector.error', (_ctx: any) => {
        throw new Error('Test error from Hook Inspector demo');
    });

    // 4. Register hooks for the tick and filter
    hooks.on('test.inspector.tick', (payload: any) => {
        console.log('[HookInspectorTest] Tick:', payload.count);
    });

    hooks.on(
        'test.inspector.filter',
        ((value: string) => {
            return value.toUpperCase();
        }) as (v: unknown) => unknown,
        { kind: 'filter' }
    );

    // 5. Add a dashboard plugin with a test button
    registerDashboardPlugin({
        id: 'hook-inspector-test',
        icon: 'pixelarticons:zap',
        label: 'Hook Test',
        description: 'Test the Hook Inspector with various hook executions',
        order: 310,
        handler: async () => {
            const toast = useToast();

            // Fire a bunch of hooks at once
            await hooks.doAction('test.rapid.action1');
            await hooks.doAction('test.rapid.action2');
            await hooks.doAction('test.rapid.action3');
            await hooks.applyFilters('test.rapid.filter1', 'hello');
            await hooks.applyFilters('test.rapid.filter2', 'world');

            // Fire the same hook multiple times
            for (let i = 0; i < 5; i++) {
                await hooks.doAction('test.rapid.burst', { iteration: i });
            }

            toast.add({
                title: 'Hooks Fired!',
                description: 'Check the Hook Inspector to see the activity',
                duration: 3000,
            });
        },
    });

    // Register the rapid test hooks
    hooks.on('test.rapid.action1', () => console.log('Rapid 1'));
    hooks.on('test.rapid.action2', () => console.log('Rapid 2'));
    hooks.on('test.rapid.action3', () => console.log('Rapid 3'));
    hooks.on('test.rapid.filter1', (v: any) => v, { kind: 'filter' });
    hooks.on('test.rapid.filter2', (v: any) => v, { kind: 'filter' });
    hooks.on('test.rapid.burst', (payload: any) => {
        console.log('Burst', payload.iteration);
    });

    console.log('[HookInspectorTest] 🎯 Plugin loaded successfully!');
    console.log('[HookInspectorTest] 📊 Background hooks will fire every 2s');
    console.log(
        '[HookInspectorTest] ⚡ Click "Hook Test" in dashboard for burst test'
    );
    console.log(
        '[HookInspectorTest] 🔍 Open "Dev Tools" → "Hook Inspector" to see activity'
    );
});
