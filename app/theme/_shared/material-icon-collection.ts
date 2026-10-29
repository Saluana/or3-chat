import material from '@iconify-json/material-symbols/icons.json';
import { DEFAULT_ICONS } from '../../config/icon-tokens';

// Material Symbols by Google, Apache 2.0:
// https://github.com/google/material-design-icons/blob/master/LICENSE
// Keep the original Material Symbols artwork available to the client and
// server without bundling the entire collection for two dynamic tokens.
// A separate prefix leaves other Material Symbols available to plugins.
const prefix = 'or3-material';
const source: Record<string, { body: string; width?: number; height?: number }> = material.icons;
const names = new Set(Object.values(DEFAULT_ICONS)
    .filter(name => name.startsWith(`${prefix}:`))
    .map(name => name.slice(prefix.length + 1)));

export default {
    prefix,
    width: material.width,
    height: material.height,
    icons: Object.fromEntries([...names].map(name => {
        const icon = source[name];
        if (!icon) throw new Error(`Unknown Material Symbols icon: ${name}`);
        return [name, icon];
    })),
};
