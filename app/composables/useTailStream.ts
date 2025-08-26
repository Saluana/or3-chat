/**
 * useTailStream
 * Incremental streaming text buffer with timed flushes.
 * Requirements: 3.2 (Streaming Tail Extraction), 3.11 (VueUse adoption), 4 (Docs)
 *
 * Usage:
 * const tail = useTailStream({ flushIntervalMs: 33, immediate: true });
 * tail.push(chunk);
 * tail.complete();
 */
import { ref, onBeforeUnmount } from 'vue';
import { useIntervalFn } from '@vueuse/core';

export interface TailStreamController {
    displayText: Ref<string>;
    isStreaming: Ref<boolean>;
    done: Ref<boolean>;
    error: Ref<Error | null>;
    push: (chunk: string) => void;
    complete: () => void;
    fail: (err: unknown) => void;
    reset: () => void;
}

export interface UseTailStreamOptions {
    flushIntervalMs?: number; // default 33 (~30fps)
    maxBuffer?: number; // optional cap of buffered (not yet flushed) characters
    immediate?: boolean; // flush synchronously on first chunk
}

export function useTailStream(
    opts: UseTailStreamOptions = {}
): TailStreamController {
    const { flushIntervalMs = 33, maxBuffer, immediate } = opts;
    const displayText = ref('');
    const buffer: string[] = [];
    const isStreaming = ref(false);
    const done = ref(false);
    const error = ref<Error | null>(null);

    const flush = () => {
        if (!buffer.length) return;
        displayText.value += buffer.join('');
        buffer.length = 0;
    };

    const {
        pause: pauseInterval,
        resume: resumeInterval,
        isActive,
    } = useIntervalFn(
        () => {
            flush();
        },
        flushIntervalMs,
        { immediate: false }
    );

    function push(chunk: string) {
        if (done.value || error.value) return;
        if (!chunk) return;
        isStreaming.value = true;
        buffer.push(chunk);
        if (maxBuffer && buffer.reduce((n, c) => n + c.length, 0) >= maxBuffer)
            flush();
        if (immediate && displayText.value === '') flush();
        if (!isActive.value) resumeInterval();
    }

    function complete() {
        flush();
        pauseInterval();
        done.value = true;
        isStreaming.value = false;
    }

    function fail(err: unknown) {
        flush();
        error.value = err instanceof Error ? err : new Error(String(err));
        pauseInterval();
    }

    function reset() {
        pauseInterval();
        displayText.value = '';
        buffer.length = 0;
        done.value = false;
        error.value = null;
        isStreaming.value = false;
    }

    onBeforeUnmount(() => pauseInterval());

    return {
        displayText,
        isStreaming,
        done,
        error,
        push,
        complete,
        fail,
        reset,
    };
}
