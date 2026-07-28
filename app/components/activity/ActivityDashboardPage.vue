<template>
    <section
        class="grid h-full min-h-[70dvh] md:grid-cols-[22rem_minmax(0,1fr)]"
        aria-label="Activity Center"
    >
        <aside
            :class="[
                'min-h-0 border-r border-[var(--md-outline-variant)]',
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
                selectedRecordId ? 'block' : 'hidden md:block',
            ]"
        >
            <div
                v-if="!selectedRecordId"
                class="flex h-full min-h-[60dvh] flex-col items-center justify-center gap-3 px-8 text-center"
            >
                <UIcon
                    name="lucide:activity"
                    class="size-10 text-[var(--md-outline)]"
                />
                <div>
                    <h2 class="font-semibold">Choose an activity</h2>
                    <p class="mt-1 max-w-md text-sm text-[var(--md-on-surface-variant)]">
                        Inspect results, approvals, artifacts, failures, and the
                        events that led to the current state.
                    </p>
                </div>
            </div>

            <template v-else>
                <div
                    class="border-b border-[var(--md-outline-variant)] px-3 py-2 md:hidden"
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
