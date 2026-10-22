// node snapshot-diff.mjs <beforeDir> <afterDir> [flips|typo|geo]  (N=<rows> to show more samples)
import { readdirSync, readFileSync, existsSync } from 'node:fs';
const [A, B, mode = 'flips'] = process.argv.slice(2);
const FLIP = ['borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth','borderTopColor','borderTopStyle','backgroundColor','boxShadow','color','opacity','display','visibility','outlineStyle','textDecorationLine','overflowX','overflowY'];
const TYPO = ['fontSize','fontWeight','lineHeight','letterSpacing','textTransform'];
const GEO = ['paddingTop','paddingRight','paddingBottom','paddingLeft','marginTop','marginRight','marginBottom','marginLeft','borderTopLeftRadius','gap','width','height'];
const want = mode === 'flips' ? FLIP : mode === 'typo' ? TYPO : GEO;
const files = readdirSync(A).filter((f) => f.startsWith('snap-') && existsSync(`${B}/${f}`));
const byProp = {}; let compared = 0;
for (const f of files) {
  const a = JSON.parse(readFileSync(`${A}/${f}`)), b = JSON.parse(readFileSync(`${B}/${f}`));
  for (const k of Object.keys(a)) { if (!b[k]) continue; compared++;
    for (const p of want) if (a[k][p] !== b[k][p]) (byProp[p] ||= []).push(`${f.replace('snap-','').replace('.json','')} ${k.split('>').slice(-3).join('>').slice(0, 90)}  ${a[k][p]} → ${b[k][p]}`); }
}
console.log(`compared ${compared} elements across ${files.length} screens (${mode})`);
for (const [p, list] of Object.entries(byProp)) { console.log(`\n== ${p}: ${list.length}`); for (const l of list.slice(0, Number(process.env.N || 8))) console.log('   ' + l); }
