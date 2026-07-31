import { defineOr3Plugin } from '@or3/plugin-sdk';

const localRef = (value) => ({ value });

export default defineOr3Plugin({
    manifest: {},
    setup(context) {
        const state = localRef('ready');
        context.logger.info(state.value);
    },
});
