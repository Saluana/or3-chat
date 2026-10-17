import { defineNuxtPlugin } from '#app';
import { registerAdminPage } from '~/composables/admin/useAdminPlugins';

// Register on server and client so the admin navigation and page hydrate identically.
export default defineNuxtPlugin(() => {
    registerAdminPage({
        id: 'cloud-waitlist', label: 'Waitlist', path: 'cloud-waitlist', order: 50,
        component: () => import('./AdminWaitlist.vue'),
    });
});
