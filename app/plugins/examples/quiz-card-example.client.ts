import { defineNuxtPlugin } from '#app';
import { vueCard } from '@or3/plugin-sdk/cards/vue';
import { registerCardTool } from '~/utils/chat/tool-cards-public';
import QuizCard from './quiz-card/QuizCard.vue';
export const quizCard = vueCard(QuizCard);
export function registerQuizExample() {
    return registerCardTool({
        name: 'quiz_ask',
        description:
            'Show one multiple-choice question in an interactive card. The card displays the question and choices, so do not repeat them in your text. Stop and wait for the user; do not reveal the answer.',
        parameters: {
            type: 'object',
            properties: {
                question: { type: 'string' },
                choices: {
                    type: 'array',
                    items: { type: 'string' },
                    minItems: 2,
                    maxItems: 6
                }
            },
            required: ['question', 'choices']
        },
        label: 'Quiz',
        card: quizCard,
        chrome: 'none',
        handler: () => ({
            shown: true,
            note: 'The interactive card already displays the question and choices. Do not repeat them. Wait for the user to answer the card.'
        })
    });
}
export default defineNuxtPlugin(() => {
    const handle = registerQuizExample();
    if (import.meta.hot) import.meta.hot.dispose(() => handle.dispose());
});
