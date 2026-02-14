/**
 * Project Tree Actions Adapter
 *
 * Wraps the project tree actions registry for sidebar project tree.
 */

import {
    registerProjectTreeAction,
    unregisterProjectTreeAction,
    listRegisteredProjectTreeActionIds,
    useProjectTreeActions,
    type ProjectTreeAction,
} from '~/composables/projects/useProjectTreeActions';
import type { RegistryAdapter } from '../utils';

/**
 * Creates the project tree actions adapter.
 */
export function createProjectTreeActionsAdapter(): RegistryAdapter<ProjectTreeAction> {
    const items = useProjectTreeActions();

    return {
        register: registerProjectTreeAction,
        unregister: unregisterProjectTreeAction,
        get: (id) => items.value.find((a) => a.id === id),
        list: () => [...items.value],
        useItems: () => items,
        listIds: listRegisteredProjectTreeActionIds,
    };
}
