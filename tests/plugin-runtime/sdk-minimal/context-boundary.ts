import type { PluginContext } from '@or3/plugin-sdk';

// The host-only identity brand prevents structural construction by plugin code.
// @ts-expect-error PluginContext must be created by the OR3 host.
const forgedContext: PluginContext = {};

void forgedContext;
