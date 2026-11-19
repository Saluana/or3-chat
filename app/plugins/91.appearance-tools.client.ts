import { getCurrentScope, onScopeDispose } from 'vue';
import { useUserThemeOverrides } from '~/core/theme/useUserThemeOverrides';
import { registerAppearanceTools } from '~/utils/chat/appearance-tools';

export default defineNuxtPlugin(() => {
    const dispose = registerAppearanceTools(useUserThemeOverrides());
    if (getCurrentScope()) onScopeDispose(dispose);
    if (import.meta.hot) import.meta.hot.dispose(dispose);
});
