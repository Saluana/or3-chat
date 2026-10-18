import { defineEventHandler, readBody, setResponseHeader } from "h3";
import { z } from "zod";
import { requireAdminApiContext } from "../../../../admin/api";
import { enforceGenericAdminRateLimit } from "../../../../admin/auth/rate-limit";
import { hasRestartController, restartControlError, saveRestartConfiguration } from "../../../../admin/system/server-control";
import { restartSettingKeys } from "../../../../../shared/admin/configuration";

const schema = z.object({
    expectedRevision: z.string().min(1).max(128),
    entries: z.array(z.object({ key: z.string().min(1).max(128), value: z.string().max(1024).nullable() }).strict()).min(1).max(2),
}).strict();
export default defineEventHandler(async event => {
    await requireAdminApiContext(event, { superAdminOnly: true, mutation: true });
    setResponseHeader(event, "Cache-Control", "no-store");
    enforceGenericAdminRateLimit(event, "configuration-save");
    const input = schema.safeParse(await readBody(event));
    if (!input.success) return restartControlError("invalid_request", 400);
    if (input.data.entries.some(entry => !restartSettingKeys.has(entry.key))) return restartControlError("configuration_requires_deployment", 501);
    // Registration has invitation prerequisites on its dedicated route.
    if (input.data.entries.some(entry => entry.key === "OR3_AUTH_REGISTRATION_MODE")) return restartControlError("use_registration_settings", 400);
    if (!hasRestartController()) return restartControlError("configuration_unsupported", 501);
    const status = await saveRestartConfiguration(Object.fromEntries(input.data.entries.map(entry => [entry.key, entry.value])), input.data.expectedRevision);
    return { ok: true, restartRequired: status.activeRevision !== status.savedRevision, savedRevision: status.savedRevision };
});
