// 分析 MXL 每个 part 的音域/均高，辅助确认哪个是女高音
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const PITCH = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

for (const file of process.argv.slice(2)) {
let text;
if (file.toLowerCase().endsWith('.mxl')) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mxl-'));
  execSync(`powershell -NoProfile -Command "Expand-Archive -LiteralPath '${file.replace(/'/g, "''")}' -DestinationPath '${tmp.replace(/'/g, "''")}'"`, { stdio: 'pipe' });
  const xmlFile = fs.readdirSync(tmp, { recursive: true }).find(f => String(f).endsWith('.xml') && !String(f).includes('META-INF'));
  text = fs.readFileSync(path.join(tmp, String(xmlFile)), 'utf8');
  fs.rmSync(tmp, { recursive: true, force: true });
} else {
  text = fs.readFileSync(file, 'utf8');
}

  console.log('== ' + path.basename(file));
  const parts = text.split(/<part id="/).slice(1);
  parts.forEach((p, i) => {
    const name = (text.match(/<part-name>([^<]*)<\/part-name>/g) || [])[i]?.replace(/<\/?part-name>/g, '') || '?';
    const midis = [];
    for (const m of p.matchAll(/<step>([A-G])<\/step>\s*(?:<alter>(-?\d)<\/alter>\s*)?<octave>(-?\d+)<\/octave>/g)) {
      midis.push(PITCH[m[1]] + Number(m[2] || 0) + (Number(m[3]) + 1) * 12);
    }
    if (!midis.length) { console.log(`  [${i}] ${name}: 无音符`); return; }
    midis.sort((a, b) => a - b);
    const avg = midis.reduce((s, x) => s + x, 0) / midis.length;
    const n2s = m => { const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']; return names[m % 12] + (Math.floor(m / 12) - 1); };
    console.log(`  [${i}] ${name}: n=${midis.length} 均高=${n2s(Math.round(avg))}(${avg.toFixed(1)}) 范围=${n2s(midis[0])}~${n2s(midis.at(-1))}`);
  });
}
