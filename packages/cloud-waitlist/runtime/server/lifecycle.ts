import { defineNitroPlugin } from 'nitropack/runtime';
import { closeWaitlist } from './store';

export default defineNitroPlugin(nitro => { nitro.hooks.hook('close', closeWaitlist); });
