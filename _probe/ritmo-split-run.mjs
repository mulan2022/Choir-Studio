// Ritmo 分段识谱驱动：3 页/本，绕过 Audiveris 每 4 页周期存档 bug
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const JAVA = 'D:/demo/ChoirSinger/tools/audiveris/Audiveris/runtime/bin/java.exe';
const CP = 'D:/demo/ChoirSinger/tools/audiveris/Audiveris/app/*';
const TMP = 'D:/demo/ChoirSinger/tmp_omr/jvm-tmp';
const groups = ['ritmo-p01-03', 'ritmo-p04-06', 'ritmo-p07-09', 'ritmo-p10-12', 'ritmo-p13-15', 'ritmo-p16-17'];
const results = [];

for (const g of groups) {
  const input = `D:/demo/ChoirSinger/tmp_omr/split/${g}.tif`;
  const outdir = `D:/demo/ChoirSinger/tmp_omr/split-out/${g}`;
  fs.rmSync(outdir, { recursive: true, force: true });
  fs.mkdirSync(outdir, { recursive: true });
  console.log(`=== ${g} 开始 ${new Date().toLocaleTimeString()}`);
  try {
    execFileSync(JAVA, ['-Xmx4g', `-Djava.io.tmpdir=${TMP}`, '-cp', CP, 'Audiveris', '-batch', '-export', '-output', outdir, '--', input], { stdio: 'pipe', timeout: 15 * 60 * 1000 });
  } catch (e) {
    // 存档崩 zipfs 会非零退出，只要 mxl 出来就行
  }
  const mxl = fs.readdirSync(outdir).find(f => f.endsWith('.mxl'));
  results.push({ g, mxl: mxl || null });
  console.log(`=== ${g} ${mxl ? 'OK ' + mxl : 'FAILED'}`);
}
console.log(JSON.stringify(results, null, 1));
