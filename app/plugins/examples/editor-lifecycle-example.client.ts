// Example plugin demonstrating editor lifecycle hooks
export default defineNuxtPlugin(() => {
    const hooks = useHooks();

    // Hook into editor creation
    hooks.addAction('editor.created:action:after', ({ editor }) => {
        if (import.meta.dev) {
            console.log('[editor-lifecycle-example] Editor created:', editor);
            console.log('[editor-lifecycle-example] Available commands:', Object.keys(editor.commands));
        }
    });

    // Hook into editor updates
    hooks.addAction('editor.updated:action:after', ({ editor }) => {
        if (import.meta.dev) {
            const wordCount = editor.getText().split(/\s+/).filter(Boolean).length;
            console.log('[editor-lifecycle-example] Editor updated. Word count:', wordCount);
        }
    });

    if (import.meta.dev) {
        console.info('[editor-lifecycle-example] Lifecycle hooks registered');
    }
});
