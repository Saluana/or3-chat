import { defineNuxtPlugin } from '#app';
import { useToast } from '#imports';
import { setErrorToastApi } from '~/utils/errors';

/**
 * Capture Nuxt UI's injected toast API while plugin setup has a valid Vue
 * context. `reportError()` can then safely display toasts from later async
 * callbacks without calling an injection-based composable out of context.
 */
export default defineNuxtPlugin(() => {
    setErrorToastApi(useToast());
});
