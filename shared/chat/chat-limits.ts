import { z } from 'zod';

export const CHAT_LIMITS_KEY = 'chat.generation.limits';
export const ChatLimitsSchema = z.object({
    toolIterations: z.number().int().min(1).max(100),
    generatedImages: z.number().int().min(0).max(24),
}).strict();
export type ChatLimits = z.infer<typeof ChatLimitsSchema>;
export const DEFAULT_CHAT_LIMITS: ChatLimits = { toolIterations: 10, generatedImages: 6 };

export function effectiveChatLimits(instance: ChatLimits, workspace: ChatLimits | null): ChatLimits {
    return workspace ? { toolIterations: Math.min(instance.toolIterations, workspace.toolIterations),
        generatedImages: Math.min(instance.generatedImages, workspace.generatedImages) } : instance;
}
