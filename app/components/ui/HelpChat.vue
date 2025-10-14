<template>
    <div class="fixed bottom-4 right-4 z-50">
        <div
            :class="{ 'h-[75dvh] w-[420px]': isExpanded }"
            class="w-10 h-10 border-2 border-[var(--md-inverse-surgace)] bg-[var(--md-surface)] transition-all"
        >
            <div
                v-show="!isExpanded"
                @click="onExpandClick"
                class="h-full w-full flex items-center justify-center cursor-pointer"
            >
                <UIcon
                    class="w-6 h-6"
                    name="pixelarticons:message-processing"
                />
            </div>

            <div v-show="isExpanded" class="w-full h-full block relative">
                <!-- Header -->
                <div
                    class="header h-[40px] w-full px-3 flex items-center justify-between border-b-2 border-[var(--md-inverse-surface)]"
                >
                    <div class="text-sm font-medium">Help Chat</div>
                    <UButton
                        size="xs"
                        icon="pixelarticons:close"
                        @click="isExpanded = false"
                    />
                </div>
                <!-- Body -->
                <div class="body p-3">
                    <div class="mb-2 text-sm">
                        This is a help chat. Ask any questions you have about
                        using the application.
                    </div>
                </div>

                <!-- Input -->
                <div
                    class="input absolute bottom-0 left-0 w-full p-3 border-t-2 border-[var(--md-inverse-surface)] bg-[var(--md-surface)]"
                >
                    <UInput
                        class="w-full"
                        placeholder="Type your message..."
                        size="md"
                    />
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
const isExpanded = ref(false);

function onExpandClick() {
    if (!isExpanded.value) {
        isExpanded.value = true;
    }
}
</script>
