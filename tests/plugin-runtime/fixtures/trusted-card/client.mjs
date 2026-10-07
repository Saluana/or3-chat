import { defineComponent, h } from 'vue';
import { vueCard } from '@or3/plugin-sdk/cards/vue';
import TrustedCard from './TrustedCard.vue';
export default {
    setup(context) {
        const tool = context.contributions.register({
            kind: 'chat.tool.client',
            id: 'fixture_trusted',
            definition: {
                type: 'function',
                function: {
                    name: 'fixture_trusted',
                    description: 'Trusted fixture',
                    parameters: { type: 'object', properties: {} }
                }
            }
        });
        const card = context.chat.registerToolCard({
            tool: 'fixture_trusted',
            label: 'Trusted weather',
            chrome: 'none',
            card: vueCard(
                defineComponent({
                    props: ['card'],
                    setup(props) {
                        return () =>
                            h(TrustedCard, { card: props.card, kit: context.ui.kit });
                    }
                })
            )
        });
        return () => {
            card.dispose();
            tool.dispose();
        };
    }
};
