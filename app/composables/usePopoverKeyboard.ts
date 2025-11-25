/**
 * Handle keyboard interaction for popover triggers.
 * Provides accessibility for Enter and Space keys to activate popover triggers.
 */
export function usePopoverKeyboard() {
    /**
     * Handle keyboard events on popover trigger elements.
     * Activates the trigger on Enter or Space key press.
     * Uses event.code for Space to handle different keyboard layouts properly.
     * 
     * @param event - The keyboard event
     */
    function handlePopoverTriggerKey(event: KeyboardEvent): void {
        const isEnter = event.key === 'Enter';
        const isSpace = event.code === 'Space' || event.key === ' ';
        if (!isEnter && !isSpace) return;
        event.preventDefault();
        event.stopPropagation();
        const target = event.currentTarget as HTMLElement | null;
        target?.click();
    }

    return {
        handlePopoverTriggerKey,
    };
}
