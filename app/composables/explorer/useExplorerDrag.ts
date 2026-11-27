import { onScopeDispose, ref, type Directive, type Ref } from 'vue';

type DragRow = {
    source?: string;
    destination?: string | null;
    label?: string;
    /** Destination name for the preview and announcement when it differs from the row's own label. */
    target?: string;
    hover?: () => void;
};

export function useExplorerDrag(options: {
    enabled: Readonly<Ref<boolean>>;
    viewport: Readonly<Ref<HTMLElement | null>>;
    rootTarget?: () => HTMLElement | null | undefined;
    start: (id: string) => void;
    move: (destination: string | null) => void;
    /** Rejects destinations that would be a no-op or invalid, so no indicator is shown for them. */
    accepts?: (destination: string | null) => boolean;
    /** Number of rows being moved, shown on the preview when above one. */
    count?: () => number;
}) {
    const rows = new WeakMap<HTMLElement, DragRow>();
    const announcement = ref('');
    const dragging = ref(false);
    /** Destination under the pointer: a folder id, null for the root, undefined for none. */
    const over = ref<string | null>();
    let cancel: (() => void) | undefined;

    function begin(event: PointerEvent) {
        const sourceElement = event.currentTarget as HTMLElement;
        const row = rows.get(sourceElement);
        const source = row?.source;
        if (!source || !options.enabled.value || !event.isPrimary || event.button !== 0 || event.pointerType === 'touch') return;
        if ((event.target as Element).closest('input, textarea, button[aria-haspopup], button[aria-expanded], [data-no-drag]')) return;
        cancel?.();
        const root = options.rootTarget?.();
        if (root) rows.set(root, { destination: null, label: root.textContent.trim() });
        const listeners = new AbortController();
        const capture = { capture: true, signal: listeners.signal };
        let preview: HTMLElement | undefined;
        let hint: HTMLElement | undefined;
        let zoom = 1;
        let target: HTMLElement | null = null;
        let timer: ReturnType<typeof setTimeout>;
        let frame = 0;
        let x = event.clientX, y = event.clientY;
        function highlight(next: HTMLElement | null) {
            if (target === next) return;
            if (target) delete target.dataset.explorerDrop;
            clearTimeout(timer);
            target = next;
            const row = target ? rows.get(target) : undefined;
            over.value = row?.destination;
            if (hint) hint.textContent = row ? row.target ?? row.label ?? '' : '';
            preview?.toggleAttribute('data-has-target', !!row);
            if (!target) return;
            target.dataset.explorerDrop = 'true';
            announcement.value = 'Move to ' + (row?.target ?? row?.label);
            if (row?.hover) timer = setTimeout(row.hover, 600);
        }
        function update() {
            // The shell zooms <body>, which also scales the preview's offsets; divide so it tracks the pointer.
            if (preview) preview.style.transform = `translate3d(${(x + 16) / zoom}px, ${(y + 18) / zoom}px, 0)`;
            let element = document.elementFromPoint(x, y) as HTMLElement | null;
            const viewport = options.viewport.value;
            if (viewport && element && viewport.contains(element)) {
                // Hit-test the visible edges, including clipping by a shorter surrounding pane.
                if (!viewport.contains(document.elementFromPoint(x, y - 24))) viewport.scrollTop -= 8;
                else if (!viewport.contains(document.elementFromPoint(x, y + 24))) viewport.scrollTop += 8;
            }
            while (element && rows.get(element)?.destination === undefined) element = element.parentElement;
            const candidate = element && rows.get(element);
            const valid = candidate && candidate.source !== source
                && (!options.accepts || options.accepts(candidate.destination ?? null));
            highlight(valid ? element : null);
            frame = requestAnimationFrame(update);
        }
        function finish() {
            preview?.remove();
            delete document.documentElement.dataset.explorerDragging;
            listeners.abort();
            cancelAnimationFrame(frame);
            highlight(null);
            if (root) rows.delete(root);
            dragging.value = false;
            cancel = undefined;
        }
        cancel = finish;
        window.addEventListener('pointermove', move => {
            if (move.pointerId !== event.pointerId) return;
            x = move.clientX; y = move.clientY;
            if (!dragging.value) {
                if (Math.hypot(x - event.clientX, y - event.clientY) < 5) return;
                dragging.value = true;
                options.start(source);
                document.documentElement.dataset.explorerDragging = 'true';
                preview = buildPreview(sourceElement, row.label ?? 'Move', options.count?.() ?? 1);
                hint = preview.querySelector<HTMLElement>('.explorer-drag-preview__hint') ?? undefined;
                document.body.append(preview);
                zoom = Number.parseFloat(getComputedStyle(document.body).zoom) || 1;
                update();
            }
            move.preventDefault();
        }, capture);
        window.addEventListener('pointerup', up => {
            if (up.pointerId !== event.pointerId) return;
            const active = dragging.value;
            if (active) {
                x = up.clientX; y = up.clientY;
                cancelAnimationFrame(frame);
                update();
            }
            const destination = target && rows.get(target);
            finish();
            if (!active) return;
            // Browsers dispatch a click after pointerup even when both land on the source.
            const suppress = (click: MouseEvent) => { click.preventDefault(); click.stopImmediatePropagation(); };
            window.addEventListener('click', suppress, { capture: true, once: true });
            setTimeout(() => window.removeEventListener('click', suppress, true), 0);
            if (options.enabled.value && destination?.destination !== undefined) options.move(destination.destination);
        }, capture);
        window.addEventListener('pointercancel', finish, capture);
        // Bubble phase: a captured listener would also see the focus moving off another element on press.
        window.addEventListener('blur', finish, { signal: listeners.signal });
        window.addEventListener('keydown', key => { if (key.key === 'Escape') finish(); }, capture);
        window.addEventListener('dragstart', native => native.preventDefault(), capture);
    }
    function buildPreview(source: HTMLElement, label: string, count: number) {
        const card = document.createElement('div');
        card.className = 'explorer-drag-preview';
        card.setAttribute('aria-hidden', 'true');
        const head = document.createElement('div');
        head.className = 'explorer-drag-preview__head';
        const icon = source.querySelector('[data-explorer-drag-handle]')?.cloneNode(true) as HTMLElement | undefined;
        if (icon) { icon.removeAttribute('data-explorer-drag-handle'); icon.classList.add('explorer-drag-preview__icon'); head.append(icon); }
        const name = document.createElement('span');
        name.className = 'explorer-drag-preview__label';
        name.textContent = label;
        head.append(name);
        if (count > 1) {
            const badge = document.createElement('span');
            badge.className = 'explorer-drag-preview__count';
            badge.textContent = String(count);
            head.append(badge);
        }
        const line = document.createElement('div');
        line.className = 'explorer-drag-preview__hint';
        card.append(head, line);
        return card;
    }
    const directive: Directive<HTMLElement, DragRow | false> = {
        mounted(el, { value }) {
            if (value) rows.set(el, value);
            el.addEventListener('pointerdown', begin);
        },
        updated(el, { value }) {
            if (value) rows.set(el, value);
            else rows.delete(el);
        },
        unmounted(el) { rows.delete(el); el.removeEventListener('pointerdown', begin); },
    };
    onScopeDispose(() => cancel?.());
    return { directive, announcement, dragging, over };
}
