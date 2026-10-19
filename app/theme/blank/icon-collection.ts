import solar from '@iconify-json/solar/icons.json';
import icons from './icons.config';

// Solar by 480 Design (CC BY 4.0):
// https://www.figma.com/community/file/1166831539721848736
// Modified below: Linear stroke widths increase from 1.5 to 2.05.
// Build only Blank's icons. A separate prefix keeps the heavier strokes out of
// other themes, while Nuxt Icon can bundle the same SVG data for SSR and static builds.
const sourceIcons: Record<string, { body: string; width?: number; height?: number }> =
    solar.icons;
const prefix = 'blank-solar';
const names = new Set(
    Object.values(icons)
        .filter((name) => name.startsWith(`${prefix}:`))
        .map((name) => name.slice(prefix.length + 1))
);

export default {
    prefix,
    width: solar.width,
    height: solar.height,
    icons: Object.fromEntries(
        [...names].map((name) => {
            const icon = sourceIcons[name];
            if (!icon) throw new Error(`Unknown Blank Solar icon: ${name}`);
            return [
                name,
                {
                    ...icon,
                    body: name.endsWith('-linear')
                        ? icon.body.replace(/stroke-width="1\.5"/g, 'stroke-width="2.05"')
                        : icon.body,
                },
            ];
        })
    ),
};
