/**
 * Entry for the standalone setup wizard (`bun run setup`). It is built once by
 * shared/cloud/wizard/ui-build.ts and served by the wizard host, not by Nuxt.
 */
import { createApp } from 'vue';
import ui from '@nuxt/ui/vue-plugin';
import blankTheme from '~/theme/blank/theme';
import { generateThemeCssVariables } from '~/theme/_shared/generate-css-variables';
import WizardApp from './WizardApp.vue';
import './wizard.css';

// The app's theme runtime is not loaded here; apply Blank's tokens directly.
const themeStyle = document.createElement('style');
themeStyle.textContent = generateThemeCssVariables(blankTheme);
document.head.append(themeStyle);

createApp(WizardApp).use(ui).mount('#app');
