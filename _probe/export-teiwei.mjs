// 导出 Te_iwi_e 的指定声部（按序号）
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const dir = '_probe/omr-out';
const f = fs.readdirSync(dir).find(x => x.startsWith('Te_iwi'));
const path = `${dir}/${f}`;

for (const idx of [1, 4]) {
  console.log(`=== 导出声部 index=${idx} ===`);
  try {
    execFileSync(process.execPath, ['_probe/export-soprano.mjs', path, 'exports'], {
      stdio: 'inherit',
      env: { ...process.env, TRACK_INDEX: String(idx) },
    });
  } catch (e) {
    console.log(`FAIL idx=${idx}: ${String(e.message).slice(0, 200)}`);
  }
}
console.log('DONE');
