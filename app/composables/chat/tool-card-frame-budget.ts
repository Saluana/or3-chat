import { inject, provide, type InjectionKey } from "vue";
interface LiveFrame {
  active: boolean;
  visible: boolean;
  touched: number;
  suspend(): void;
  resume(): void;
}
export function createToolCardFrameBudget() {
  const frames = new Map<symbol, LiveFrame>();
  let queued = false;
  function balance(requesting?: symbol) {
    const active = [...frames].filter(([, frame]) => frame.active);
    const waiting = [...frames]
      .filter(([, frame]) => !frame.active)
      .sort(
        (a, b) =>
          Number(b[1].visible) - Number(a[1].visible) ||
          a[1].touched - b[1].touched,
      );
    for (const [id, frame] of waiting) {
      if (active.length >= 12) {
        // A preload never takes a slot from a visible frame. A newly
        // visible card can reclaim an offscreen slot, without cycling
        // through other visible cards when the viewport exceeds the cap.
        if (!frame.visible) break;
        const victim = active
          .filter(([, candidate]) => !candidate.visible)
          .sort((a, b) => a[1].touched - b[1].touched)[0];
        if (!victim) break;
        active.splice(active.indexOf(victim), 1);
        victim[1].active = false;
        victim[1].suspend();
      }
      frame.active = true;
      active.push([id, frame]);
      if (id !== requesting) frame.resume();
    }
  }
  function schedule() {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      balance();
    });
  }
  return {
    acquire(
      id: symbol,
      suspend: () => void,
      visible: boolean,
      resume: () => void,
    ) {
      if (!frames.has(id)) {
        frames.set(id, {
          active: false,
          visible,
          touched: performance.now(),
          suspend,
          resume,
        });
      }
      balance(id);
      return frames.get(id)!.active;
    },
    touch(id: symbol, visible: boolean) {
      const frame = frames.get(id);
      if (frame) {
        frame.visible = visible;
        if (visible) frame.touched = performance.now();
        schedule();
      }
    },
    release(id: symbol) {
      frames.delete(id);
      schedule();
    },
  };
}
const key: InjectionKey<ReturnType<typeof createToolCardFrameBudget>> = Symbol(
  "tool-card-frame-budget",
);
export function provideToolCardFrameBudget() {
  provide(key, createToolCardFrameBudget());
}
export function useToolCardFrameBudget() {
  return inject(key, null);
}
