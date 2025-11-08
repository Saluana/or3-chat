/**
 * Composable for applying theme CSS selector classes to lazy-loaded components
 * 
 * Use this in components that are lazy-loaded or dynamically rendered
 * to ensure theme classes are applied even if the component wasn't
 * present when the theme was initialized.
 * 
 * @example
 * ```vue
 * <script setup>
 * // In a lazy-loaded component
 * useThemeClasses();
 * </script>
 * ```
 */

import { onMounted } from 'vue';
import { applyThemeClasses } from '~/theme/_shared/css-selector-runtime';

export function useThemeClasses() {
    const { activeTheme, loadTheme } = useTheme();
    
    onMounted(async () => {
        // Get current theme
        const themeName = activeTheme.value;
        
        // Ensure theme is loaded
        const theme = await loadTheme(themeName);
        
        // Apply classes if theme has cssSelectors
        if (theme?.cssSelectors) {
            applyThemeClasses(themeName, theme.cssSelectors);
        }
    });
}
