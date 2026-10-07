import { createApp, defineComponent, h, shallowRef, type Component } from 'vue';
import { toolCardSnapshot, type ToolCardModule } from './cards';
export function vueCard(component: Component): ToolCardModule {
    return {
        component,
        mount(el, card) {
            const snapshot = shallowRef(toolCardSnapshot(card));
            const stop = card.onUpdate(() => {
                snapshot.value = toolCardSnapshot(card);
            });
            const app = createApp(
                defineComponent({
                    setup: () => () => h(component, { card: snapshot.value })
                })
            );
            app.config.errorHandler = () => {
                el.dispatchEvent(new Event('or3:card-error'));
            };
            try {
                app.mount(el);
            } catch (error) {
                stop();
                app.unmount();
                throw error;
            }
            let disposed = false;
            return () => {
                if (disposed) return;
                disposed = true;
                stop();
                app.unmount();
            };
        }
    };
}
