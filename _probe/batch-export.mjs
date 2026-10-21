// 批量导出：对 omr-out 里所有 .mxl 逐个跑 export-soprano.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const dir = '_probe/omr-out';
const outDir = 'exports';
const files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.mxl'));

for (const f of files) {
  const out = path.join(outDir, f.replace(/\.mxl$/i, ''));
  if (fs.existsSync(out + '.wav')) {
    console.log(`SKIP ${f} (已存在)`);
    continue;
  }
  console.log(`EXPORT ${f} ...`);
  try {
    execFileSync(process.execPath, ['_probe/export-soprano.mjs', path.join(dir, f), outDir], { stdio: 'inherit' });
    console.log(`OK ${f}`);
  } catch (e) {
    console.log(`FAIL ${f}: ${String(e.message).slice(0, 200)}`);
  }
}
console.log('BATCH EXPORT DONE');
