/**
 * @module server/plugins/10.tool-registry
 *
 * Purpose:
 * Register built-in server tool handlers used by background execution.
 *
 * Notes:
 * - Mirrors the demo client tools so hybrid behavior works in background mode.
 * - Provider/plugin packages can register additional tools via `registerServerTool`.
 */

import type { ToolDefinition } from '~/utils/chat/types';
import { registerServerTool } from '../utils/chat/tool-registry';

const calculateTool: ToolDefinition = {
    type: 'function',
    function: {
        name: 'calculate',
        description:
            'Perform arithmetic operations (add, subtract, multiply, divide).',
        parameters: {
            type: 'object',
            properties: {
                operation: {
                    type: 'string',
                    enum: ['add', 'subtract', 'multiply', 'divide'],
                    description: 'Operation to perform',
                },
                a: { type: 'number', description: 'First number' },
                b: { type: 'number', description: 'Second number' },
            },
            required: ['operation', 'a', 'b'],
        },
    },
    runtime: 'hybrid',
};

const addNumbersTool: ToolDefinition = {
    type: 'function',
    function: {
        name: 'add_numbers',
        description: 'Add two numbers and return the sum.',
        parameters: {
            type: 'object',
            properties: {
                a: { type: 'number', description: 'First number' },
                b: { type: 'number', description: 'Second number' },
            },
            required: ['a', 'b'],
        },
    },
    runtime: 'hybrid',
};

const coinGeckoPriceTool: ToolDefinition = {
    type: 'function',
    function: {
        name: 'coingecko_price',
        description: 'Fetch a coin price from CoinGecko by id and vs currency.',
        parameters: {
            type: 'object',
            properties: {
                coinId: {
                    type: 'string',
                    description:
                        'CoinGecko coin id (e.g., bitcoin, ethereum)',
                },
                vsCurrency: {
                    type: 'string',
                    description: 'Quote currency (e.g., usd, eur)',
                },
            },
            required: ['coinId', 'vsCurrency'],
        },
    },
    runtime: 'hybrid',
};

function asFiniteNumber(value: unknown): number {
    const num = typeof value === 'number' ? value : Number.NaN;
    if (!Number.isFinite(num)) {
        throw new Error('Expected a finite number.');
    }
    return num;
}

function normalizeString(value: unknown): string {
    if (typeof value !== 'string') return '';
    return value.trim().toLowerCase();
}

async function fetchCoinGeckoPrice(
    coinId: string,
    vsCurrency: string
): Promise<number> {
    const url = new URL('https://api.coingecko.com/api/v3/simple/price');
    url.searchParams.set('ids', coinId);
    url.searchParams.set('vs_currencies', vsCurrency);

    const response = await fetch(url.toString(), {
        headers: { accept: 'application/json' },
    });

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(
            `CoinGecko request failed: ${response.status} ${text.slice(0, 120)}`
        );
    }

    const payload: unknown = await response.json();
    if (!payload || typeof payload !== 'object') {
        throw new Error('CoinGecko returned an invalid payload.');
    }
    const coinData = (payload as Record<string, unknown>)[coinId];
    if (!coinData || typeof coinData !== 'object') {
        throw new Error(`No price found for "${coinId}" in "${vsCurrency}".`);
    }
    const price = (coinData as Record<string, unknown>)[vsCurrency];
    if (typeof price !== 'number') {
        throw new Error(
            `No price found for "${coinId}" in "${vsCurrency}".`
        );
    }
    return price;
}

export default defineNitroPlugin(() => {
    registerServerTool(
        calculateTool,
        async (args) => {
            const operation = normalizeString(args.operation);
            const a = asFiniteNumber(args.a);
            const b = asFiniteNumber(args.b);

            let result: number;
            switch (operation) {
                case 'add':
                    result = a + b;
                    break;
                case 'subtract':
                    result = a - b;
                    break;
                case 'multiply':
                    result = a * b;
                    break;
                case 'divide':
                    if (b === 0) throw new Error('Cannot divide by zero');
                    result = a / b;
                    break;
                default:
                    throw new Error(`Unknown operation: ${operation}`);
            }

            return `Calculation complete: ${a} ${operation} ${b} = ${result}`;
        },
        { override: true }
    );

    registerServerTool(
        addNumbersTool,
        async (args) => {
            const a = asFiniteNumber(args.a);
            const b = asFiniteNumber(args.b);
            const sum = a + b;
            return `Sum: ${a} + ${b} = ${sum}`;
        },
        { override: true }
    );

    registerServerTool(
        coinGeckoPriceTool,
        async (args) => {
            const coinId = normalizeString(args.coinId);
            const vsCurrency = normalizeString(args.vsCurrency);
            if (!coinId || !vsCurrency) {
                throw new Error('coinId and vsCurrency are required.');
            }

            const price = await fetchCoinGeckoPrice(coinId, vsCurrency);
            return `CoinGecko price for ${coinId} in ${vsCurrency.toUpperCase()}: ${price}`;
        },
        { override: true }
    );
});
