import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';
import { useIcon } from '../useIcon';

// Mock dependencies
const mockResolve = vi.fn();
const mockActiveTheme = ref('default');

vi.mock('#app', () => ({
    useNuxtApp: () => ({
        $iconRegistry: {
            resolve: mockResolve,
        },
    }),
}));

vi.mock('../useThemeResolver', () => ({
    useThemeResolver: () => ({
        activeTheme: mockActiveTheme,
    }),
}));

describe('useIcon', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockActiveTheme.value = 'default';
    });

    it('returns a computed property that resolves the icon', () => {
        mockResolve.mockReturnValue('pixelarticons:test');

        const icon = useIcon('ui.trash');

        expect(icon.value).toBe('pixelarticons:test');
        expect(mockResolve).toHaveBeenCalledWith('ui.trash', 'default');
    });

    it('reacts to theme changes', () => {
        mockResolve.mockImplementation((token, theme) => {
            if (theme === 'default') return 'default:icon';
            if (theme === 'dark') return 'dark:icon';
            return 'unknown:icon';
        });

        const icon = useIcon('ui.trash');

        expect(icon.value).toBe('default:icon');

        // Change theme
        mockActiveTheme.value = 'dark';

        expect(icon.value).toBe('dark:icon');
        expect(mockResolve).toHaveBeenCalledWith('ui.trash', 'dark');
    });
});
