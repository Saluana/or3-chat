import { computed, shallowRef, type HTMLAttributes } from 'vue';
import { useDialogViewport, type DialogLayout } from './useDialogViewport';
import type { ModalProps } from '@nuxt/ui';
import { createSharedComposable, useEventListener } from '@vueuse/core';

// One scoped listener for all hosts. Safari clicks blur buttons before autofocus.
const useDialogOpener = createSharedComposable(() => {
    const pointerOpener = shallowRef<{ element: HTMLElement; at: number } | null>(null);
    const target = () => import.meta.client ? document : undefined;
    useEventListener(target, 'pointerdown', (event: PointerEvent) => {
        const element = event.target instanceof Element
            ? event.target.closest<HTMLElement>('button, a[href], input, [role="button"], [role="option"]') : null;
        pointerOpener.value = element ? { element, at: Date.now() } : null;
    }, { capture: true });
    useEventListener(target, 'keydown', () => { pointerOpener.value = null; }, { capture: true });
    return pointerOpener;
});

/** Controlled dialogs have no DialogTrigger for Reka to restore focus to. */
type DialogContent = NonNullable<ModalProps['content']> & HTMLAttributes & { 'data-compact-viewport'?: string };

export function useDialogFocus(
    options: () => DialogContent | undefined = () => undefined,
    layout: () => DialogLayout = () => 'center',
) {
    const viewport = useDialogViewport(layout);
    const pointerOpener = useDialogOpener();
    let opener: HTMLElement | null = null;
    const usable = (element: HTMLElement | null): element is HTMLElement => Boolean(
        element?.isConnected && element !== document.body &&
        !element.closest('[inert], [aria-hidden="true"]') &&
        !element.matches(':disabled') && element.getClientRects().length
    );

    return computed<DialogContent>(() => ({
        ...options(),
        ...viewport.value,
        style: [options()?.style, viewport.value.style],
        onOpenAutoFocus(event: Event) {
            const pointer = pointerOpener.value;
            opener = pointer?.element.isConnected && Date.now() - pointer.at < 2000
                ? pointer.element
                : document.activeElement instanceof HTMLElement ? document.activeElement : null;
            options()?.onOpenAutoFocus?.(event);
        },
        onKeydown(event: KeyboardEvent) {
            options()?.onKeydown?.(event);
            if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return;
            if (event.defaultPrevented) {
                // Reka may have handled an edge before this handler runs.
                (document.activeElement as HTMLElement | null)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                return;
            }
            const dialog = event.currentTarget as HTMLElement;
            // Safari can skip buttons in its native Tab order. Advance through
            // the dialog's actual controls so focus cannot fall into browser chrome.
            const controls = Array.from(dialog.querySelectorAll<HTMLElement>(
                'button, a[href], input:not([type="hidden"]), select, textarea, [contenteditable="true"], [tabindex]'
            )).filter(element => usable(element) && element.tabIndex >= 0);
            if (!controls.length) return;
            const index = controls.indexOf(document.activeElement as HTMLElement);
            const current = index < 0 && event.shiftKey ? 0 : index;
            const next = (current + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
            event.preventDefault();
            event.stopImmediatePropagation();
            controls[next]?.focus();
            controls[next]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        },
        onCloseAutoFocus(event: Event) {
            options()?.onCloseAutoFocus?.(event);
            if (event.defaultPrevented) return;
            event.preventDefault();
            const target = opener;
            opener = null;
            // Reka removes the outgoing focus scope and aria-hidden siblings
            // after this event. Restore only once that cleanup has completed.
            requestAnimationFrame(() => {
                // An action can close this dialog while opening another. Leave the
                // new dialog's focus alone instead of racing its autofocus.
                const active = document.activeElement as HTMLElement | null;
                const activeDialog = usable(active) ? active.closest('[role="dialog"][data-state="open"]') : null;
                if (activeDialog && !activeDialog.contains(target)) return;
                if (usable(target)) {
                    target.focus();
                    return;
                }
                // The original control may have vanished or become inert on resize.
                const fallback = Array.from(document.querySelectorAll<HTMLElement>(
                    '[role="dialog"][data-state="open"] button, button[aria-label="Open sidebar"], [role="textbox"][aria-label="Message input"]'
                )).find(usable);
                fallback?.focus();
            });
        },
    }));
}
