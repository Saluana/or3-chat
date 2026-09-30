/**
 * Registers the connection providers this host can use.
 *
 * Providers are declared once here; the dispatcher refuses any operation a
 * provider has not listed, so this file is the whole egress allowlist.
 */
import { defineNitroPlugin } from 'nitropack/runtime/plugin';
import { registerConnectionProvider } from '../utils/plugins/connections/providers/registry';
import { OPENROUTER_CONNECTION_PROVIDER } from '../utils/plugins/connections/providers/openrouter';

export default defineNitroPlugin(() => {
    registerConnectionProvider(OPENROUTER_CONNECTION_PROVIDER);
});
