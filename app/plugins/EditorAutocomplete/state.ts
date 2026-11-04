import { ref } from 'vue';

export default ref({
    isEnabled: true,
    isLoading: false,
    lastError: null as string | null,
});
