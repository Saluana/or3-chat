import { ref, watch, type Ref } from 'vue';

export function useExplorerSelection(order: Readonly<Ref<readonly string[]>>) {
    const selected = ref(new Set<string>());
    const selectMode = ref(false);
    let anchor: string | undefined;

    function clear() {
        selected.value = new Set();
        anchor = undefined;
    }

    watch(order, (current, previous) => {
        if (current.length === previous.length && current.every((id, index) => id === previous[index])) return;
        const eligible = new Set(current);
        selected.value = new Set([...selected.value].filter(id => eligible.has(id)));
        anchor = undefined;
    });

    function choose(id: string, event: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } = {}, toggle = false) {
        if (event.shiftKey && anchor) {
            const start = order.value.indexOf(anchor);
            const end = order.value.indexOf(id);
            if (start !== -1 && end !== -1) {
                const range = order.value.slice(Math.min(start, end), Math.max(start, end) + 1);
                selected.value = new Set(event.ctrlKey || event.metaKey ? [...selected.value, ...range] : range);
                return false;
            }
        }
        anchor = id;
        if (toggle || selectMode.value || event.ctrlKey || event.metaKey || event.shiftKey) {
            const next = new Set(selected.value);
            if (!next.delete(id)) next.add(id);
            selected.value = next;
            return false;
        }
        selected.value = new Set([id]);
        return true;
    }

    function all() {
        selected.value = new Set(order.value);
        anchor = order.value[0];
    }

    return { selected, selectMode, choose, clear, all };
}
