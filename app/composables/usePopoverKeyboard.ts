/**
 * Handle keyboard interaction for popover triggers.
 * Provides accessibility for Enter and Space keys to activate popover triggers.
 */
export function usePopoverKeyboard() {
    /**
     * Handle keyboard events on popover trigger elements.
     * Activates the trigger on Enter or Space key press.
     * 
     * @param event - The keyboard event
     */
    function handlePopoverTriggerKey(event: KeyboardEvent): void {
        const key = event.key;
        if (key !== 'Enter' && key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        const target = event.currentTarget as HTMLElement | null;
        target?.click();
    }

    return {
        handlePopoverTriggerKey,
    };
}
