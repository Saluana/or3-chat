/** Regenerate static artwork copies. Requires Python with Pillow/WebP/AVIF. */
import { resolve } from 'node:path';
const result = Bun.spawnSync([
    process.env.OR3_ARTWORK_PYTHON ?? 'python3', '-c', `
from pathlib import Path
from PIL import Image
import sys
root = Path(sys.argv[1]) / 'public'
out = root / 'chat-artwork'
out.mkdir(exist_ok=True)
for name in ['bird-on-cloud', 'bird-on-cloud-dark', 'blank-chat-background', 'blank-chat-bg-dark']:
    image = Image.open(root / (name + '.webp'))
    background = name.startswith('blank-chat-')
    for width in ([768, 1448] if background else [480, 960]):
        resized = image.resize((width, round(image.height * width / image.width)), Image.Resampling.LANCZOS)
        resized.save(out / f'{name}-{width}.webp', format='WEBP', quality=80, method=6)
        if background:
            resized.save(out / f'{name}-{width}.avif', format='AVIF', quality=80, speed=6)
`, resolve(import.meta.dir, '../..'),
], { stdout: 'inherit', stderr: 'inherit' });
if (result.exitCode !== 0) throw new Error('Artwork generation failed; originals are unchanged.');
