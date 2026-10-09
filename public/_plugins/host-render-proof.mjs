// Precompiled Vue render used by the live host ABI compatibility proof.
// The bare import resolves through the host import map in the browser.
import { toDisplayString, openBlock, createElementBlock } from 'vue';

const attributes = { id: 'or3-host-abi-proof' };

export function render(context) {
    return (openBlock(), createElementBlock('p', attributes, toDisplayString(context.label), 1));
}
