/**
 * Global Cmd/Ctrl+K handler for the command palette.
 *
 * Listens on `window` in capture phase so the palette wins over pane-local
 * handlers, and defers all state changes to the palette controller.
 */
import { onBeforeUnmount, onMounted } from 'vue';
import { scheduleCommandPalettePrewarm } from '~/core/search/command-palette/prewarm';
import { useCommandPalette } from './useCommandPalette';

export function useCommandPaletteShortcut(): void {
    const { open, close, isOpen } = useCommandPalette();

    function onKeydown(event: KeyboardEvent): void {
        // Never hijack composition or an event another handler already claimed.
        if (event.defaultPrevented || event.isComposing) return;
        if (event.key !== 'k' && event.key !== 'K') return;
        if (!(event.metaKey || event.ctrlKey)) return;
        if (event.altKey || event.shiftKey) return;
        event.preventDefault();
        // Repeated presses refocus rather than stacking overlays.
        open();
    }

    function onEscape(event: KeyboardEvent): void {
        if (event.key !== 'Escape' || !isOpen.value) return;
        close();
    }

    onMounted(() => {
        window.addEventListener('keydown', onKeydown, { capture: true });
        window.addEventListener('keydown', onEscape);
        // Preload code only; workspace-wide indexes are built on first open.
        scheduleCommandPalettePrewarm();
    });

    onBeforeUnmount(() => {
        window.removeEventListener('keydown', onKeydown, { capture: true });
        window.removeEventListener('keydown', onEscape);
    });
}
