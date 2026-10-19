import type { Directive } from 'vue';

const START_DELAY_MS = 450;
const SPEED_PX_PER_SECOND = 40;

export interface TitleMarquee {
    /** Restarts the scroll when the title text changed while hovered. */
    refresh(): void;
    destroy(): void;
}

/**
 * While the pointer hovers (or keyboard focus is within) the host, scrolls a
 * truncated single-line title to its end, then holds there. Leaving restores
 * the ellipsis. The host is the closest `[data-marquee-host]`, else the
 * title's parent.
 */
export function attachTitleMarquee(el: HTMLElement): TitleMarquee {
    const host =
        el.closest<HTMLElement>('[data-marquee-host]') ?? el.parentElement ?? el;
    let timer: number | undefined;
    let frame: number | undefined;
    let active = false;
    let text = el.textContent;

    const stop = () => {
        window.clearTimeout(timer);
        if (frame !== undefined) cancelAnimationFrame(frame);
        timer = frame = undefined;
        active = false;
        el.style.textOverflow = '';
        el.scrollLeft = 0;
    };

    const scrollTo = (distance: number) => {
        const startedAt = performance.now();
        const step = (now: number) => {
            const travelled = Math.min(
                distance,
                ((now - startedAt) / 1000) * SPEED_PX_PER_SECOND
            );
            el.scrollLeft = travelled;
            frame = travelled < distance ? requestAnimationFrame(step) : undefined;
        };
        frame = requestAnimationFrame(step);
    };

    const start = () => {
        stop();
        active = true;
        if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
        timer = window.setTimeout(() => {
            timer = undefined;
            const distance = el.scrollWidth - el.clientWidth;
            if (distance <= 1) return;
            el.style.textOverflow = 'clip';
            scrollTo(distance);
        }, START_DELAY_MS);
    };

    const onPointerEnter = (event: PointerEvent) => {
        if (event.pointerType !== 'touch') start();
    };
    const onFocusIn = (event: FocusEvent) => {
        if ((event.target as HTMLElement).matches(':focus-visible')) start();
    };

    host.addEventListener('pointerenter', onPointerEnter);
    host.addEventListener('pointerleave', stop);
    host.addEventListener('focusin', onFocusIn);
    host.addEventListener('focusout', stop);

    return {
        refresh() {
            if (el.textContent === text) return;
            text = el.textContent;
            if (active) start();
        },
        destroy() {
            stop();
            host.removeEventListener('pointerenter', onPointerEnter);
            host.removeEventListener('pointerleave', stop);
            host.removeEventListener('focusin', onFocusIn);
            host.removeEventListener('focusout', stop);
        },
    };
}

const marquees = new WeakMap<HTMLElement, TitleMarquee>();

/** `v-title-marquee` on a `truncate` title element. */
export const vTitleMarquee: Directive<HTMLElement> = {
    mounted(el) {
        marquees.set(el, attachTitleMarquee(el));
    },
    updated(el) {
        marquees.get(el)?.refresh();
    },
    beforeUnmount(el) {
        marquees.get(el)?.destroy();
        marquees.delete(el);
    },
};
