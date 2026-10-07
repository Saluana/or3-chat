<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, h } from 'vue';
import { defineToolCard, createToolCardHarness } from '@or3/plugin-sdk/cards';
import { vueCard } from '@or3/plugin-sdk/cards/vue';
import { reactCard } from '@or3/plugin-sdk/cards/react';
import { createElement } from 'react';
const roots = ref<HTMLElement[]>([]);
const receipt = ref('');
const cleanups = [0, 0, 0];
const harnesses = [0, 1, 2].map(() => createToolCardHarness({ args: 'initial' }));
let dispose: (() => void)[] = [];
function update() {
    for (const harness of harnesses) harness.update({ args: 'updated' });
    void harnesses[0]!.card.send('answer');
    void harnesses[0]!.card.openLink('https://example.com');
    void harnesses[0]!.card.setState(null);
}
function remove() {
    for (const stop of dispose) {
        stop();
        stop();
    }
    receipt.value = JSON.stringify({
        cleanups,
        aborted: harnesses.map((h) => h.card.signal.aborted),
        calls: harnesses[0]!.calls
    });
}
onMounted(() => {
    const modules = [
        defineToolCard<string>({
            mount(el, card) {
                const render = () => (el.textContent = String(card.args));
                render();
                return card.onUpdate(render);
            }
        }),
        vueCard({
            props: ['card'],
            render() {
                return h('span', String(this.card.args));
            }
        }),
        reactCard(({ card }) => createElement('span', null, String(card.args)))
    ];
    dispose = modules.map((module, index) =>
        harnesses[index]!.mount(
            {
                mount(el, card) {
                    const stop = module.mount(el, card);
                    return () => {
                        cleanups[index]++;
                        stop?.();
                    };
                }
            },
            roots.value[index]!
        )
    );
});
onBeforeUnmount(remove);
</script>
<template>
    <section>
        <div
            v-for="(kind, index) in ['vanilla', 'vue', 'react']"
            :key="kind"
            :ref="
                (el) => {
                    if (el) roots[index] = el as HTMLElement;
                }
            "
            :data-helper="kind"
        />
        <button @click="update">Update SDK harness</button
        ><button @click="remove">Dispose SDK harness</button
        ><output data-helper-receipt>{{ receipt }}</output>
    </section>
</template>
