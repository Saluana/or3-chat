import { createElement, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { toolCardSnapshot, type ToolCardContext, type ToolCardModule } from './cards';
export function reactCard<A = unknown, R = unknown, S = unknown>(
    component: ComponentType<{ card: ToolCardContext<A, R, S> }>
): ToolCardModule<A, R, S> {
    return {
        mount(el, card) {
            const root = createRoot(el, {
                onUncaughtError() {
                    el.dispatchEvent(new Event('or3:card-error'));
                }
            });
            const render = () =>
                root.render(createElement(component, { card: toolCardSnapshot(card) }));
            const stop = card.onUpdate(render);
            try {
                render();
            } catch (error) {
                stop();
                root.unmount();
                throw error;
            }
            let disposed = false;
            return () => {
                if (disposed) return;
                disposed = true;
                stop();
                root.unmount();
            };
        }
    };
}
