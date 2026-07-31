import { computed, onMounted, ref } from 'vue';
import { navigateTo, useRoute } from '#imports';
import { getDb } from '~/db/client';

export interface UseValidatedEntityPageShellOptions<T> {
    loadEntity: (id: string) => Promise<T | null | undefined>;
    redirectTo: string;
    isDeleted?: (entity: T) => boolean;
}

export function useValidatedEntityPageShell<T>(
    options: UseValidatedEntityPageShellOptions<T>
) {
    const route = useRoute();
    const routeId = computed(() => (route.params.id as string) || '');
    const ready = ref(false);

    onMounted(async () => {
        try {
            if (!getDb().isOpen()) {
                await getDb().open();
            }

            const entity = await options.loadEntity(routeId.value);
            const deleted = entity
                ? options.isDeleted?.(entity) ?? Boolean((entity as { deleted?: boolean }).deleted)
                : true;

            if (!entity || deleted) {
                await navigateTo(options.redirectTo, { replace: true });
                return;
            }

            ready.value = true;
        } catch {
            await navigateTo(options.redirectTo, { replace: true });
        }
    });

    return {
        ready,
        routeId,
    };
}
