import { defineNuxtPlugin } from '#app';
import { defineToolCard } from '@or3/plugin-sdk/cards';
import { registerCardTool } from '~/utils/chat/tool-cards-public';
export const quizCard = defineToolCard<
    { question: string; choices: string[] },
    unknown,
    { picked: number }
>({
    mount(el, card) {
        let saving = false;
        let feedback = '';
        const render = () => {
            const question = document.createElement('p');
            question.textContent = card.args?.question ?? '';
            const controls = document.createElement('div');
            controls.className = 'flex flex-wrap gap-2 mt-3';
            const error = document.createElement('p');
            error.setAttribute('role', 'status');
            error.textContent = saving
                ? 'Saving answer…'
                : feedback || (card.state !== null ? 'Answer saved' : '');
            for (const [index, choice] of (card.args?.choices ?? []).entries()) {
                const button = document.createElement('button');
                button.type = 'button';
                button.textContent = choice;
                button.className = 'retro-btn px-3 py-2';
                button.disabled = card.state !== null;
                button.setAttribute(
                    'aria-pressed',
                    String(card.state?.picked === index)
                );
                button.onclick = async () => {
                    button.disabled = true;
                    const result = await card.send('My answer: ' + choice);
                    if (result.ok) {
                        saving = true;
                        feedback = '';
                        const saved = await card.setState({ picked: index });
                        if (!card.signal.aborted) {
                            saving = false;
                            feedback = saved.ok ? '' : saved.error.message;
                            render();
                        }
                    } else {
                        feedback = result.error.message;
                        render();
                    }
                };
                controls.append(button);
            }
            el.replaceChildren(question, controls, error);
        };
        render();
        return card.onUpdate(render);
    }
});
export function registerQuizExample() {
    return registerCardTool({
        name: 'quiz_ask',
        description:
            'Show one multiple-choice question. Stop and wait for the user; do not reveal the answer.',
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
        handler: () => ({
            shown: true,
            note: 'Wait for the user to answer the card.'
        })
    });
}
export default defineNuxtPlugin(() => {
    const handle = registerQuizExample();
    if (import.meta.hot) import.meta.hot.dispose(() => handle.dispose());
});
