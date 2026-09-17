<script setup lang="ts">
/**
 * Host surface for one contained portable plugin.
 *
 * It renders exactly what the plugin rendered (a validated declarative tree),
 * plus the plugin's status. UI events from the tree are forwarded to the plugin
 * as a request; the plugin may render again. Nothing here executes plugin code.
 */
import { computed, ref } from 'vue';
import { useToast } from '#imports';
import {
    invokePortableUiEvent,
    usePortableActivations,
} from '~/composables/plugins/portable-client-runtime';
import type { PortableUiNode } from '~~/shared/plugins/isolation/ui-primitives';
import type { PortableUiEvent } from '~~/shared/plugins/isolation/ui-primitives';

const props = defineProps<{ readonly pluginId: string }>();

const toast = useToast();
const activations = usePortableActivations();
const activation = computed(() => activations.get(props.pluginId) ?? null);
const busy = ref(false);
const fieldStore = ref<Record<string, string | boolean>>({});

const nodes = computed<readonly PortableUiNode[]>(
    () => activation.value?.view?.nodes ?? []
);

const statusLabel = computed(() => {
    const state = activation.value;
    if (!state) return 'Not running';
    if (state.status === 'active') return 'Running';
    if (state.status === 'starting') return 'Starting';
    if (state.status === 'blocked') return 'Blocked';
    return 'Stopped';
});

async function forwardUiEvent(payload: PortableUiEvent): Promise<void> {
    if (payload.kind !== 'action') return;
    busy.value = true;
    try {
        await invokePortableUiEvent(props.pluginId, {
            action: payload.action,
            ...(payload.formId === undefined ? {} : { formId: payload.formId }),
            values: payload.values,
        });
    } catch (error) {
        toast.add({
            title: 'Plugin action failed',
            description:
                error instanceof Error ? error.message : 'The plugin did not accept the action',
            color: 'error',
        });
    } finally {
        busy.value = false;
    }
}
</script>

<template>
    <div class="flex flex-col gap-4">
        <div
            v-if="!activation"
            class="text-sm text-(--ui-text-muted)"
            data-testid="portable-plugin-idle"
        >
            This plugin is not running in the current workspace.
        </div>

        <UAlert
            v-else-if="activation.status === 'blocked'"
            color="warning"
            variant="subtle"
            title="This plugin cannot run here"
            :description="`${activation.blockMessage ?? 'The host blocked this package.'} (${activation.blockCode ?? 'blocked'})`"
            data-testid="portable-plugin-blocked"
        />

        <div v-else-if="activation.status === 'starting'" class="flex items-center gap-2 text-sm">
            <UIcon name="i-lucide-loader-circle" class="animate-spin" />
            <span>Starting {{ activation.version }}…</span>
        </div>

        <template v-else>
            <div class="flex items-center gap-2 text-xs text-(--ui-text-muted)">
                <UBadge color="neutral" variant="subtle">{{ statusLabel }}</UBadge>
                <span>v{{ activation.version }}</span>
                <span v-if="activation.crashed" class="text-red-500">containment violation</span>
            </div>

            <PortableUiTree
                v-if="nodes.length > 0"
                :nodes="nodes"
                :store="fieldStore"
                :aria-busy="busy"
                data-testid="portable-plugin-view"
                @ui-event="forwardUiEvent"
            />
            <div v-else class="text-sm text-(--ui-text-muted)">
                The plugin has not rendered anything yet.
            </div>

            <details
                v-if="activation.logs.length > 0"
                class="rounded-md border border-(--ui-border) p-2 text-xs"
                data-testid="portable-plugin-logs"
            >
                <summary class="cursor-pointer">Plugin activity ({{ activation.logs.length }})</summary>
                <ul class="mt-2 flex flex-col gap-1">
                    <li v-for="(entry, index) in activation.logs" :key="index">
                        <span class="font-medium">{{ entry.level }}</span>
                        {{ entry.message }}
                    </li>
                </ul>
            </details>
        </template>
    </div>
</template>
