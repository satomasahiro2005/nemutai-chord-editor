// Plays every fixture with the engine and compares the notes with the saved
// expectations in test/expected/. The expectations were checked against the
// REAPER JSFX version and against rechord itself before they were saved.
// `node test/run.mjs --update` rewrites them after an intended change.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse, renderNotes } from '../public/engine.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const update = process.argv.includes('--update');
const round = (x) => Math.round(x * 10000) / 10000;

function play(text) {
  const out = {};
  for (const ts of ['4/4', '3/4', '6/8']) {
    for (const rhythm of [true, false]) {
      const S = parse(text, { projectTs: ts.split('/').map(Number) });
      out[`${ts} ${rhythm ? 'rhythm' : 'hold'}`] = {
        total: round(S.total),
        warnings: S.warnings.map((w) => [round(w.start), round(w.written)]),
        notes: renderNotes(S, { rhythm }).map((n) => [round(n.t), n.vel, ...n.notes]),
      };
    }
  }
  return out;
}

let fail = 0, count = 0;
fs.mkdirSync(path.join(dir, 'expected'), { recursive: true });
for (const f of fs.readdirSync(path.join(dir, 'fixtures')).filter((f) => f.endsWith('.txt')).sort()) {
  const got = play(fs.readFileSync(path.join(dir, 'fixtures', f), 'utf8'));
  const file = path.join(dir, 'expected', f.replace(/\.txt$/, '.json'));
  count++;
  if (update || !fs.existsSync(file)) { fs.writeFileSync(file, JSON.stringify(got) + '\n'); continue; }
  const want = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const k of Object.keys(want)) {
    const a = JSON.stringify(got[k]), b = JSON.stringify(want[k]);
    if (a === b) continue;
    fail++;
    const gn = got[k].notes, wn = want[k].notes;
    let i = 0;
    while (i < Math.min(gn.length, wn.length) && JSON.stringify(gn[i]) === JSON.stringify(wn[i])) i++;
    console.log(`FAIL ${f} [${k}] total ${got[k].total}/${want[k].total}, first difference at note #${i}: got ${JSON.stringify(gn[i])} want ${JSON.stringify(wn[i])}`);
  }
}
console.log(update ? `updated ${count} expectations` : fail ? `${fail} failures` : `ok: ${count} fixtures`);
process.exit(fail ? 1 : 0);
