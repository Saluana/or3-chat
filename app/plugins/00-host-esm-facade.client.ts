import * as Sdk from '@or3/plugin-sdk';
import * as Vue from 'vue';

type Or3HostAbiGlobal = typeof globalThis & {
    __or3HostAbi?: {
        readonly vue: typeof Vue;
        readonly sdk: typeof Sdk;
    };
};

/** Publish the running app's Vue and SDK so trusted plugin modules share them. */
export default defineNuxtPlugin(() => {
    (globalThis as Or3HostAbiGlobal).__or3HostAbi = Object.freeze({
        vue: Vue,
        sdk: Sdk,
    });
});
