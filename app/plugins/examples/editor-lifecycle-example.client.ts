// Example plugin demonstrating editor lifecycle hooks
export default defineNuxtPlugin(() => {
    const hooks = useHooks();

    // Hook into editor creation
    hooks.addAction('editor.created:action:after', ({ editor }) => {
        if (import.meta.dev) {
            const ed = editor as any;
            console.log('[editor-lifecycle-example] Editor created:', ed);
            if (ed && ed.commands) {
                console.log('[editor-lifecycle-example] Available commands:', Object.keys(ed.commands));
            }
        }
    });

    // Hook into editor updates
    hooks.addAction('editor.updated:action:after', ({ editor }) => {
        if (import.meta.dev) {
            const wordCount = (editor as any).getText().split(/\s+/).filter(Boolean).length;
            console.log('[editor-lifecycle-example] Editor updated. Word count:', wordCount);
        }
    });

    if (import.meta.dev) {
        console.info('[editor-lifecycle-example] Lifecycle hooks registered');
    }
});
