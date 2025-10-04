export interface ScrollMetrics {
    scrollTop?: number;
    scrollHeight?: number;
    clientHeight?: number;
}

export function setScrollMetrics(el: HTMLElement, metrics: ScrollMetrics) {
    const { scrollTop, scrollHeight, clientHeight } = metrics;
    if (typeof scrollTop === 'number') {
        Object.defineProperty(el, 'scrollTop', {
            value: scrollTop,
            configurable: true,
            writable: true,
        });
    }
    if (typeof scrollHeight === 'number') {
        Object.defineProperty(el, 'scrollHeight', {
            value: scrollHeight,
            configurable: true,
        });
    }
    if (typeof clientHeight === 'number') {
        Object.defineProperty(el, 'clientHeight', {
            value: clientHeight,
            configurable: true,
        });
    }
}
