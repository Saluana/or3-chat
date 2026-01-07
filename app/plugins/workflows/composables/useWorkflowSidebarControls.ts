import { ref, type Ref } from 'vue';
import { useActiveSidebarPage } from '~/composables/sidebar/useActiveSidebarPage';
import { getGlobalSidebarLayoutApi } from '~/utils/sidebarLayoutApi';

export type WorkflowSidebarPanel = 'workflows' | 'palette' | 'inspector';

interface WorkflowSidebarControls {
    activePanel: Ref<WorkflowSidebarPanel>;
    setPanel: (
        panel: WorkflowSidebarPanel,
        options?: { activateSidebarPage?: boolean }
    ) => Promise<void>;
    openInspector: () => Promise<void>;
}

function createControls(): WorkflowSidebarControls {
    const activePanel = ref<WorkflowSidebarPanel>('workflows');
    const { setActivePage } = useActiveSidebarPage();

    async function setPanel(
        panel: WorkflowSidebarPanel,
        options: { activateSidebarPage?: boolean } = { activateSidebarPage: true }
    ) {
        activePanel.value = panel;
        if (options.activateSidebarPage !== false) {
            await setActivePage('or3-workflows-page');
        }
    }

    async function openInspector() {
        await setPanel('inspector');
        getGlobalSidebarLayoutApi()?.expand();
    }

    return {
        activePanel,
        setPanel,
        openInspector,
    };
}

export function useWorkflowSidebarControls(): WorkflowSidebarControls {
    const g = globalThis as {
        __or3WorkflowSidebarControls?: WorkflowSidebarControls;
    };

    if (!g.__or3WorkflowSidebarControls) {
        g.__or3WorkflowSidebarControls = createControls();
    }

    return g.__or3WorkflowSidebarControls;
}
