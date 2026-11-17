import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { autoScrollForElements } from '@atlaskit/pragmatic-drag-and-drop-auto-scroll/element';
import { ref, watchEffect, type Directive, type Ref } from 'vue';

type DragRow = {
    source?: string;
    destination?: string | null;
    label?: string;
    hover?: () => void;
};

export function useExplorerDrag(options: {
    enabled: Readonly<Ref<boolean>>;
    viewport: Readonly<Ref<HTMLElement | null>>;
    start: (id: string) => void;
    move: (destination: string | null) => void;
    reject: (message: string) => void;
}) {
    const owner = Symbol('explorer');
    const announcement = ref('');
    const dragging = ref(false);
    const registrations = new WeakMap<HTMLElement, { row: DragRow; cleanup: () => void }>();
    function mount(element: HTMLElement, row: DragRow) {
        const state = { row, cleanup: () => {} };
        registrations.set(element, state);
        let timer: ReturnType<typeof setTimeout> | undefined;
        function leave() {
            clearTimeout(timer);
            delete element.dataset.explorerDrop;
        }
        state.cleanup = combine(
            leave,
            ...(row.source === undefined ? [] : [draggable({
                element,
                canDrag: () => options.enabled.value,
                getInitialData: () => ({ owner, id: state.row.source }),
                onDragStart: () => {
                    dragging.value = true;
                    if (state.row.source) options.start(state.row.source);
                },
                onDrop: () => { dragging.value = false; },
            })]),
            ...(row.destination === undefined ? [] : [dropTargetForElements({
                element,
                canDrop: ({ source }) => options.enabled.value && typeof source.data.owner === 'symbol',
                getDropEffect: () => 'move',
                onDragEnter: ({ source }) => {
                    if (source.data.owner !== owner) return;
                    element.dataset.explorerDrop = 'true';
                    announcement.value = `Move to ${state.row.label}`;
                    timer = setTimeout(() => state.row.hover?.(), 600);
                },
                onDragLeave: leave,
                onDrop: ({ source, location }) => {
                    leave();
                    if (location.current.dropTargets[0]?.element !== element) return;
                    if (source.data.owner !== owner) {
                        options.reject('Choose a destination within the same explorer.');
                        return;
                    }
                    if (state.row.destination !== undefined) options.move(state.row.destination);
                },
            })]),
        );
    }
    const directive: Directive<HTMLElement, DragRow | false> = {
        mounted(element, { value }) { if (value) mount(element, value); },
        updated(element, { value, oldValue }) {
            const state = registrations.get(element);
            if (state && value && oldValue && value.source === oldValue.source && value.destination === oldValue.destination) {
                state.row = value;
                return;
            }
            state?.cleanup();
            registrations.delete(element);
            if (value) mount(element, value);
        },
        unmounted(element) { registrations.get(element)?.cleanup(); registrations.delete(element); },
    };
    watchEffect(onCleanup => {
        const element = options.viewport.value;
        if (!element || !options.enabled.value) return;
        onCleanup(autoScrollForElements({ element, canScroll: ({ source }) => source.data.owner === owner }));
    });
    return { directive, announcement, dragging };
}
