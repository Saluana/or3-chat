import { defineNuxtPlugin } from '#app';
import { registerLockPageAdapter } from '~/core/lock-page/registry';
import Welcome from './Welcome.vue';

export default defineNuxtPlugin(() => {
    registerLockPageAdapter({ id: 'cloud-waitlist', component: Welcome });
});
