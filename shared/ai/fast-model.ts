import { z } from 'zod';

/** One small, quick model for host tasks: chat and document titles, editor autocomplete and project memory. */
export const DEFAULT_FAST_MODEL = 'deepseek/deepseek-v4.1-flash:nitro';
// Stored under its original title-only key so saved choices carry over.
export const FAST_MODEL_SETTING = 'ai.title_generation_model';
// OpenRouter routing suffixes are preserved and :online is deliberately unavailable; direct-OpenAI IDs take none.
export const FastModelSchema = z.string().max(200).regex(/^(?:@openai\/[\w.-]+|[\w.~/-]+(?::free)?(?::(?:nitro|floor))?)$/);
