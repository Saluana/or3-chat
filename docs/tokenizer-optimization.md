# Token counting in source UI

The source composable is
[useTokenizer](../app/composables/core/useTokenizer.ts).
It exposes asynchronous `countTokens(text)`, `countTokensBatch(items)`,
and an `isReady` ref. Requests share a browser worker;
[the worker](../app/workers/tokenizer.worker.ts) dynamically imports
`gpt-tokenizer`.

## Fallback and accuracy

SSR skips the worker. When worker initialization or a request fails, the
current fallback estimates `Math.ceil(text.length / 4)`; it does not download
the tokenizer onto the main thread. Worker counts use the bundled encoder and
are also not a promise of exact billing for every selected model.
`isReady` means initialization has finished, not that the worker succeeded.

## Use the existing owner

Create the composable during setup and await its methods:

```ts
import { useTokenizer } from '~/composables/core/useTokenizer';

const { countTokens, countTokensBatch } = useTokenizer();
const count = await countTokens('Hello world');
const counts = await countTokensBatch([
    { key: 'first', text: 'First prompt' },
    { key: 'second', text: 'Second prompt' },
]);
```

Use distinct batch keys; repeated keys overwrite earlier results. Counts are
not cached by input. Guard asynchronous UI results so an older count cannot
replace newer text, and batch related prompts instead of starting separate
workers. HMR teardown terminates the worker.

Chat context budgeting belongs to the existing
[chat lifecycle](../public/_documentation/architecture/chat-lifecycle.md#context-and-tools).
Do not derive a second admission policy from a UI estimate.
