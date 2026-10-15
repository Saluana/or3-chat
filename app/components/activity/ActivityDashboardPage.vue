<template>
    <section
        class="grid h-full min-h-[22rem] grid-cols-[minmax(0,1fr)] md:grid-cols-[20rem_minmax(0,1fr)] lg:grid-cols-[22rem_minmax(0,1fr)]"
        aria-label="Activity Center"
    >
        <aside
            :class="[
                'min-h-0 md:border-r md:border-[var(--md-outline-variant)]',
                selectedRecordId ? 'hidden md:block' : 'block',
            ]"
        >
            <ActivityRunList
                :selected-record-id="selectedRecordId"
                @select="selectedRecordId = $event"
            />
        </aside>

        <main
            :class="[
                'min-h-0 bg-[var(--md-surface)]',
                selectedRecordId ? 'flex flex-col' : 'hidden md:flex md:flex-col',
            ]"
        >
            <div
                v-if="!selectedRecordId"
                class="flex flex-1 flex-col items-center justify-center gap-3 px-8 py-12 text-center"
            >
                <span
                    class="flex size-14 items-center justify-center rounded-full bg-[var(--md-surface-container)]"
                    aria-hidden="true"
                >
                    <UIcon
                        name="lucide:mouse-pointer-click"
                        class="size-6 text-[var(--md-on-surface-variant)]"
                    />
                </span>
                <div>
                    <h2 class="font-semibold text-[var(--md-on-surface)]">Choose an activity</h2>
                    <p class="mt-1 max-w-xs text-sm text-[var(--md-on-surface-variant)]">
                        Select an activity to view its results and approvals.
                    </p>
                </div>
            </div>

            <template v-else>
                <div
                    class="shrink-0 border-b border-[var(--md-outline-variant)] px-2 py-2 md:hidden"
                >
                    <UButton
                        size="sm"
                        color="neutral"
                        variant="ghost"
                        icon="lucide:arrow-left"
                        @click="selectedRecordId = null"
                    >
                        All activity
                    </UButton>
                </div>
                <ActivityDetailPane
                    class="min-h-0 flex-1"
                    pane-id="dashboard-activity"
                    :record-id="selectedRecordId"
                    embedded
                />
            </template>
        </main>
    </section>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import ActivityDetailPane from './ActivityDetailPane.vue';
import ActivityRunList from './ActivityRunList.vue';

defineOptions({ name: 'or3-activity-dashboard-page' });

const selectedRecordId = ref<string | null>(null);
</script>
