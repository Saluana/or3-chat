import { ref } from 'vue';
import { countTokensApprox } from '~/utils/chat/tokens';

/** Estimate token counts locally using the same approximation as chat. */
export function useTokenizer() {
    const countTokensBatch = async (items: Array<{ key: string; text: string }>): Promise<Record<string, number>> => {
        const counts = await Promise.all(items.map(async ({ key, text }) => [key, await countTokensApprox(text)] as const));
        return Object.fromEntries(counts);
    };

    return { countTokens: countTokensApprox, countTokensBatch, isReady: ref(true) };
}
