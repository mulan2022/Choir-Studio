// 批量：PDF → pdftoppm → 多页TIFF → Audiveris(直连java,自定义tmpdir) → MXL
// 用法: node _probe/omr-batch.mjs <pdf...>   输出 _probe/omr-out/<slug>.mxl
// 环境变量 OMR_DPI 默认 300
import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const JAVA = path.join(ROOT, 'tools/audiveris/Audiveris/runtime/bin/java.exe');
const APP = path.join(ROOT, 'tools/audiveris/Audiveris/app');
const PDFTOPPM = path.join(ROOT, 'tools/runtime/poppler/Library/bin/pdftoppm.exe');
const WORK = path.join(ROOT, 'tmp_omr');
const OUT = path.join(ROOT, '_probe/omr-out');
const JTMP = path.join(WORK, 'jtmp-' + process.pid);
const DPI = process.env.OMR_DPI || '300';
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(JTMP, { recursive: true });

const slugify = s => s.replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 60);

for (const pdf of process.argv.slice(2)) {
  const slug = slugify(path.basename(pdf));
  const dir = path.join(WORK, slug);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'out'), { recursive: true });
  const t0 = Date.now();
  try {
    console.log(`### ${slug} | 1/3 rasterize ${DPI}dpi`);
    execFileSync(PDFTOPPM, ['-r', DPI, '-gray', '-png', pdf, path.join(dir, 'page')], { stdio: ['ignore', 'ignore', 'pipe'] });
    const pages = fs.readdirSync(dir).filter(f => /^page-\d+\.png$/.test(f)).sort();
    if (!pages.length) throw new Error('pdftoppm 没有产出页面');
    console.log(`### ${slug} | ${pages.length} 页, 2/3 合并TIFF`);
    const tif = path.join(dir, 'score.tif');
    const dirF = dir.replace(/\\/g, '/');
    const tifF = tif.replace(/\\/g, '/');
    execSync(`python -c "from PIL import Image; import glob; files=sorted(glob.glob(r'${dirF}/page-*.png')); ims=[Image.open(f) for f in files]; ims[0].save(r'${tifF}', save_all=True, append_images=ims[1:], compression='tiff_lzw')"`, { stdio: 'inherit' });
    console.log(`### ${slug} | 3/3 Audiveris`);
    execFileSync(JAVA, [`-Djava.io.tmpdir=${JTMP}`, '-cp', `${APP}\\*`, 'Audiveris', '-batch', '-export', '-swap', '-output', path.join(dir, 'out'), '--', tif], { stdio: ['ignore', 'ignore', 'inherit'] });
    const outDir = path.join(dir, 'out');
    const produced = fs.readdirSync(outDir);
    const mxl = produced.find(f => f.toLowerCase().endsWith('.mxl')) || produced.find(f => /\.(musicxml|xml)$/i.test(f));
    if (!mxl) throw new Error('Audiveris 未产出 MXL: ' + produced.join(','));
    const dest = path.join(OUT, `${slug}.mxl`);
    fs.copyFileSync(path.join(outDir, mxl), dest);
    console.log(`### ${slug} | DONE ${dest} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  } catch (e) {
    console.log(`### ${slug} | FAILED: ${String(e.message).slice(0, 300)}`);
  }
}
console.log('### ALL DONE');
