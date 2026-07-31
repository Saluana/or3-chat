import { computed, ref } from 'vue';
import type { Component, ComponentPublicInstance } from 'vue';
import { onKeyStroke, useDebounceFn } from '@vueuse/core';
import { VueRenderer } from '@tiptap/vue-3';
import type { SuggestionProps } from '@tiptap/suggestion';

type SuggestionListInstance = ComponentPublicInstance & {
    onKeyDown?: (payload: unknown) => boolean;
};

export interface SuggestionPopoverProps<TItem, TCommandInput> {
    items: TItem[];
    command: (item: TCommandInput) => void;
    getReferenceClientRect?: () => DOMRect | null;
    open: boolean;
}

export function useSuggestionPopover<TItem, TCommandInput = TItem>(
    props: SuggestionPopoverProps<TItem, TCommandInput>,
    close: () => void,
    mapCommand: (item: TItem) => TCommandInput = ((item) =>
        item as unknown as TCommandInput)
) {
    const listRef = ref<SuggestionListInstance | null>(null);

    onKeyStroke(
        'Escape',
        (event) => {
            if (!props.open) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            close();
        },
        { target: typeof window !== 'undefined' ? window : undefined }
    );

    const virtualReference = {
        getBoundingClientRect: () => {
            try {
                const rect = props.getReferenceClientRect?.();
                if (rect) {
                    return rect;
                }
            } catch {}

            return new DOMRect(0, 0, 0, 0);
        },
        contextElement:
            typeof document !== 'undefined' ? document.body : undefined,
    };

    const popoverContentProps = computed(() => ({
        side: 'top' as const,
        align: 'start' as const,
        sideOffset: 6,
        updatePositionStrategy: 'always' as const,
        reference: virtualReference as any,
        trapFocus: false as any,
        openAutoFocus: false as any,
        closeAutoFocus: false as any,
    }));

    function handleCommand(item: TItem) {
        props.command(mapCommand(item));
    }

    function onKeyDown(payload: unknown) {
        return listRef.value?.onKeyDown?.(payload) ?? false;
    }

    function hide() {
        close();
    }

    return {
        handleCommand,
        hide,
        listRef,
        onKeyDown,
        popoverContentProps,
    };
}

export function createSuggestionItemsLoader<TItem>(
    searchFn: (query: string) => Promise<TItem[]>,
    debounceMs = 100
) {
    const debouncedSearch = useDebounceFn(searchFn, debounceMs);

    return async ({ query }: { query: string }) => {
        const results = await debouncedSearch(query);
        return results || [];
    };
}

export function createSuggestionRenderLifecycle<TItem>(
    component: Component,
    getComponentProps?: (
        props: SuggestionProps<TItem>
    ) => Record<string, unknown>
) {
    let renderer: VueRenderer | null = null;

    function buildDefaultProps(props: SuggestionProps<TItem>) {
        return {
            items: props.items,
            command: props.command,
            getReferenceClientRect: props.clientRect,
            open: true,
            onClose: () => {
                props.editor
                    ?.chain()
                    .focus()
                    .deleteRange({
                        from: props.range.from,
                        to: props.range.to,
                    })
                    .run();
            },
        };
    }

    return () => ({
        onStart(props: SuggestionProps<TItem>) {
            renderer = new VueRenderer(component, {
                editor: props.editor,
                props: getComponentProps?.(props) ?? buildDefaultProps(props),
            });

            if (renderer.element) {
                document.body.appendChild(renderer.element);
            }

            try {
                setTimeout(() => {
                    props.editor?.commands?.focus?.();
                }, 0);
            } catch {}
        },

        onUpdate(props: SuggestionProps<TItem>) {
            if (!renderer) {
                return;
            }

            renderer.updateProps(
                getComponentProps?.(props) ?? buildDefaultProps(props)
            );

            try {
                setTimeout(() => {
                    props.editor?.commands?.focus?.();
                }, 0);
            } catch {}
        },

        onKeyDown(props: { event: KeyboardEvent }) {
            return (renderer?.ref as SuggestionListInstance | undefined)?.onKeyDown?.(
                props
            ) ?? false;
        },

        onExit() {
            if (renderer?.element?.parentNode) {
                renderer.element.parentNode.removeChild(renderer.element);
            }
            renderer?.destroy();
            renderer = null;
        },
    });
}
