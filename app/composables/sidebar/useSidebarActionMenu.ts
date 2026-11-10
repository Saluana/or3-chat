import { onScopeDispose, ref, useId, watch } from 'vue';

/** Keep the lazily mounted sidebar action popovers mutually exclusive. */
export function useSidebarActionMenu() {
    const activeMenu = useState<string | null>('sidebar-active-action-menu', () => null);
    const id = useId();
    const open = ref(false);

    watch(open, (isOpen) => {
        if (isOpen) activeMenu.value = id;
        else if (activeMenu.value === id) activeMenu.value = null;
    }, { flush: 'sync' });
    watch(activeMenu, (active) => {
        if (active !== id) open.value = false;
    }, { flush: 'sync' });

    onScopeDispose(() => {
        if (activeMenu.value === id) activeMenu.value = null;
    });

    return open;
}
