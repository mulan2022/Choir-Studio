// Downloads the trimmed sound bank into public/soundfonts/ so a fresh clone can
// build the static site without the original 70 MB source bank.
//
//   SOUNDFONT_URL=https://... npm run fetch:soundfont
import fs from 'node:fs/promises';
import path from 'node:path';

const target = process.argv[2] || 'public/soundfonts/choir-practice-lite.sf2';
const url = process.env.SOUNDFONT_URL || process.argv[3];
if (!url) {
  console.error('缺少声库地址。用法：SOUNDFONT_URL=https://… npm run fetch:soundfont');
  console.error('这个地址应该是 choir-practice-lite.sf2（约 31.6 MB）的直链：Cloudflare R2 公共域名或 GitHub Release 资源。');
  process.exit(1);
}

const response = await fetch(url);
if (!response.ok) {
  console.error(`下载失败：HTTP ${response.status} ${url}`);
  process.exit(1);
}
const bytes = Buffer.from(await response.arrayBuffer());
if (bytes.byteLength < 20 * 1024 * 1024) console.warn(`警告：只下载到 ${(bytes.byteLength / 1048576).toFixed(1)} MB，可能不是完整的声库。`);
await fs.mkdir(path.dirname(target), { recursive: true });
await fs.writeFile(target, bytes);
console.log(`已保存 ${target}（${(bytes.byteLength / 1048576).toFixed(1)} MB）`);
