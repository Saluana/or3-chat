import { registerTasksRuntime } from './tasks/runtime/register';

export default defineNuxtPlugin(() => {
    if (!process.client) return;
    const dispose = registerTasksRuntime('builtin');

    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            dispose();
        });
    }
});
