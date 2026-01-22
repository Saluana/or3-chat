/**
 * Manual test script for notification center
 * 
 * Run this in the browser console to test notifications:
 * 
 * 1. Open the app in the browser
 * 2. Open the developer console
 * 3. Run the following commands to test:
 */

// Test 1: Create a simple notification
async function testCreateNotification() {
    const { useHooks } = await import('~/core/hooks/useHooks');
    const hooks = useHooks();
    
    await hooks.doAction('notify:action:push', {
        type: 'test',
        title: 'Test Notification',
        body: 'This is a test notification from the console.',
    });
    
    console.log('✅ Test notification created');
}

// Test 2: Create notification with actions
async function testNotificationWithActions() {
    const { useHooks } = await import('~/core/hooks/useHooks');
    const hooks = useHooks();
    
    await hooks.doAction('notify:action:push', {
        type: 'ai.message.received',
        title: 'New AI Response',
        body: 'Your AI has finished generating a response.',
        threadId: 'test-thread-id',
        actions: [
            {
                id: 'view',
                label: 'View Thread',
                kind: 'navigate',
                target: { threadId: 'test-thread-id' }
            }
        ]
    });
    
    console.log('✅ Notification with action created');
}

// Test 3: Create multiple notifications
async function testMultipleNotifications() {
    const { useHooks } = await import('~/core/hooks/useHooks');
    const hooks = useHooks();
    
    const types = [
        'ai.message.received',
        'workflow.completed',
        'sync.conflict',
        'system.warning'
    ];
    
    for (let i = 0; i < 5; i++) {
        await hooks.doAction('notify:action:push', {
            type: types[i % types.length],
            title: `Test Notification ${i + 1}`,
            body: `This is test notification number ${i + 1}.`,
        });
    }
    
    console.log('✅ Created 5 test notifications');
}

// Test 4: Check unread count
async function testUnreadCount() {
    const { useNotifications } = await import('~/composables/notifications/useNotifications');
    const { unreadCount } = useNotifications();
    
    // Wait a tick for Vue reactivity
    await new Promise(resolve => setTimeout(resolve, 100));
    
    console.log(`📬 Unread count: ${unreadCount.value}`);
}

// Test 5: Mark all as read
async function testMarkAllRead() {
    const { useNotifications } = await import('~/composables/notifications/useNotifications');
    const { markAllRead, unreadCount } = useNotifications();
    
    console.log(`📬 Before: ${unreadCount.value} unread`);
    await markAllRead();
    
    // Wait for update
    await new Promise(resolve => setTimeout(resolve, 100));
    console.log(`📬 After: ${unreadCount.value} unread`);
    console.log('✅ Marked all as read');
}

// Test 6: Clear all notifications
async function testClearAll() {
    const { useNotifications } = await import('~/composables/notifications/useNotifications');
    const { clearAll, notifications } = useNotifications();
    
    console.log(`📬 Before: ${notifications.value.length} notifications`);
    const count = await clearAll();
    console.log(`🗑️ Cleared ${count} notifications`);
    
    // Wait for update
    await new Promise(resolve => setTimeout(resolve, 100));
    console.log(`📬 After: ${notifications.value.length} notifications`);
}

// Export test functions to global scope for easy access
if (typeof window !== 'undefined') {
    (window as any).notificationTests = {
        testCreateNotification,
        testNotificationWithActions,
        testMultipleNotifications,
        testUnreadCount,
        testMarkAllRead,
        testClearAll,
    };
    
    console.log('🧪 Notification tests loaded. Available commands:');
    console.log('  • notificationTests.testCreateNotification()');
    console.log('  • notificationTests.testNotificationWithActions()');
    console.log('  • notificationTests.testMultipleNotifications()');
    console.log('  • notificationTests.testUnreadCount()');
    console.log('  • notificationTests.testMarkAllRead()');
    console.log('  • notificationTests.testClearAll()');
}
