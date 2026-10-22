// node summary.mjs <beforeDir> <afterDir>  -> distinct sizes, weights, radii and fractional metrics
import { readFileSync, readdirSync } from 'node:fs';
const [A, B] = process.argv.slice(2);
const sum = (dir) => {
  const sizes = new Map(), weights = new Map(), radii = new Map(); let frac = 0, elements = 0, screens = 0, lhFrac = 0;
  for (const f of readdirSync(dir).filter((f) => f.startsWith('snap-'))) {
    screens++;
    const snap = JSON.parse(readFileSync(`${dir}/${f}`));
    for (const o of Object.values(snap)) {
      elements++;
    }
  }
  const m = JSON.parse(readFileSync(`${dir}/metrics.json`));
  for (const [k, v] of Object.entries(m)) {
    if (!v || !v.fonts) continue;
    for (const [key, n] of Object.entries(v.fonts)) {
      const [size, weight, lh] = key.split('/'); sizes.set(size, (sizes.get(size) || 0) + n); weights.set(weight, (weights.get(weight) || 0) + n);
      const px = parseFloat(lh.replace('lh', '')); if (!Number.isNaN(px) && Math.abs(px - Math.round(px)) > 0.05) lhFrac += n;
    }
    for (const [r, n] of Object.entries(v.radii || {})) radii.set(r, (radii.get(r) || 0) + n);
    frac += v.fractionalHeights || 0;
  }
  const sortNum = (m) => [...m.entries()].sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]));
  return { screens, sizes: sortNum(sizes), weights: sortNum(weights), radii: sortNum(radii), frac, lhFrac };
};
const a = sum(A), b = sum(B);
const fmt = (l) => l.map(([k, n]) => `${k}(${n})`).join(' ');
console.log(`screens ${a.screens} → ${b.screens}`);
console.log(`distinct font sizes   ${a.sizes.length} → ${b.sizes.length}\n  before: ${fmt(a.sizes)}\n  after : ${fmt(b.sizes)}`);
console.log(`distinct font weights ${a.weights.length} → ${b.weights.length}\n  before: ${fmt(a.weights)}\n  after : ${fmt(b.weights)}`);
console.log(`distinct radii        ${a.radii.length} → ${b.radii.length}\n  before: ${fmt(a.radii)}\n  after : ${fmt(b.radii)}`);
console.log(`elements with fractional height ${a.frac} → ${b.frac}`);
console.log(`text runs with fractional line-height ${a.lhFrac} → ${b.lhFrac}`);
