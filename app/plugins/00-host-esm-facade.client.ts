import type * as Sdk from '@or3/plugin-sdk';
import * as Vue from 'vue';

type Or3HostAbiGlobal = typeof globalThis & {
    __or3HostAbi?: {
        readonly vue: typeof Vue;
        readonly sdk: typeof Sdk;
    };
};

/** Publish the running app's Vue and SDK so trusted plugin modules share them. */
export default defineNuxtPlugin(async () => {
    const config = useRuntimeConfig();
    if (config.public.ssrAuthEnabled !== true && config.public.pluginDevelopment !== true) return;
    const Sdk = await import('@or3/plugin-sdk');
    (globalThis as Or3HostAbiGlobal).__or3HostAbi = Object.freeze({
        vue: Vue,
        sdk: Sdk,
    });
});
