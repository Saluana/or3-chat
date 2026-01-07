/**
 * Demo Workflow Tools - Example Plugin
 *
 * Registers simple tools for workflow and chat tool-calling tests.
 */

import { defineNuxtPlugin } from '#app';
import { onScopeDispose } from 'vue';
import { useToolRegistry, defineTool } from '~/utils/chat/tools-public';

export default defineNuxtPlugin(() => {
    if (!process.client) return;

    const { registerTool, unregisterTool } = useToolRegistry();

    const addNumbersTool = defineTool({
        type: 'function' as const,
        function: {
            name: 'add_numbers',
            description: 'Add two numbers and return the sum.',
            parameters: {
                type: 'object' as const,
                properties: {
                    a: {
                        type: 'number' as const,
                        description: 'First number',
                    },
                    b: {
                        type: 'number' as const,
                        description: 'Second number',
                    },
                },
                required: ['a', 'b'],
            },
        },
        ui: {
            label: 'Add Numbers',
            icon: 'tabler:plus',
            descriptionHint: 'Add two numbers and return the result',
            defaultEnabled: true,
            category: 'Demo Tools',
        },
    });

    const coingeckoPriceTool = defineTool({
        type: 'function' as const,
        function: {
            name: 'coingecko_price',
            description:
                'Fetch a coin price from CoinGecko by id and vs currency.',
            parameters: {
                type: 'object' as const,
                properties: {
                    coinId: {
                        type: 'string' as const,
                        description:
                            'Coin id from CoinGecko (e.g., bitcoin, ethereum)',
                    },
                    vsCurrency: {
                        type: 'string' as const,
                        description:
                            'Fiat or crypto currency (e.g., usd, eur, btc)',
                    },
                },
                required: ['coinId', 'vsCurrency'],
            },
        },
        ui: {
            label: 'CoinGecko Price',
            icon: 'tabler:currency-bitcoin',
            descriptionHint: 'Fetch live prices from CoinGecko',
            defaultEnabled: true,
            category: 'Demo Tools',
        },
    });

    registerTool(
        addNumbersTool,
        async (args) => {
            const { a, b } = args as { a: number; b: number };
            if (!Number.isFinite(a) || !Number.isFinite(b)) {
                throw new Error('Both a and b must be valid numbers.');
            }
            const sum = a + b;
            return `Sum: ${a} + ${b} = ${sum}`;
        },
        { enabled: true }
    );

    registerTool(
        coingeckoPriceTool,
        async (args) => {
            const { coinId, vsCurrency } = args as {
                coinId: string;
                vsCurrency: string;
            };
            const safeCoinId = String(coinId || '').trim().toLowerCase();
            const safeCurrency = String(vsCurrency || '').trim().toLowerCase();

            if (!safeCoinId || !safeCurrency) {
                throw new Error('coinId and vsCurrency are required.');
            }

            const url = new URL('/api/coingecko/price', window.location.origin);
            url.searchParams.set('ids', safeCoinId);
            url.searchParams.set('vs_currencies', safeCurrency);

            const response = await fetch(url.toString(), {
                headers: { accept: 'application/json' },
            });
            if (!response.ok) {
                throw new Error(
                    `CoinGecko request failed: ${response.status} ${response.statusText}`
                );
            }

            const data = (await response.json()) as Record<
                string,
                Record<string, number>
            >;
            const price = data?.[safeCoinId]?.[safeCurrency];
            if (typeof price !== 'number') {
                throw new Error(
                    `No price found for "${safeCoinId}" in "${safeCurrency}".`
                );
            }

            return `CoinGecko price for ${safeCoinId} in ${safeCurrency.toUpperCase()}: ${price}`;
        },
        { enabled: true }
    );

    onScopeDispose(() => {
        unregisterTool('add_numbers');
        unregisterTool('coingecko_price');
    });
});
