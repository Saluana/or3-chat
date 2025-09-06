import { ref } from 'vue';

export const state = ref({
    openrouterKey: '' as string | null,
});

export const isMobile = ref<boolean>(false);
