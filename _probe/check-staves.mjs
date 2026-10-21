// 逐字复制 server 的 hasStaves 逻辑，逐页验证
import fs from 'node:fs';

function pgmPixels(bytes) {
  let position = 0;
  const next = () => {
    while (position < bytes.length) {
      if (bytes[position] === 35) { while (position < bytes.length && bytes[position] !== 10) position++; }
      else if (bytes[position] <= 32) position++;
      else break;
    }
    const start = position;
    while (position < bytes.length && bytes[position] > 32 && bytes[position] !== 35) position++;
    return bytes.toString('ascii', start, position);
  };
  if (next() !== 'P5') throw new Error('无法读取 PDF 预览图。');
  const width = Number(next());
  const height = Number(next());
  const max = Number(next());
  if (!width || !height || max !== 255) throw new Error('PDF 预览图格式不受支持。');
  if (bytes[position] === 13 && bytes[position + 1] === 10) position += 2;
  else position++;
  if (bytes.length - position < width * height) throw new Error('PDF 预览图不完整。');
  return { width, height, pixels: bytes.subarray(position, position + width * height) };
}

function hasStavesVerbose(bytes) {
  const { width, height, pixels } = pgmPixels(bytes);
  const left = Math.floor(width * 0.12);
  const right = Math.floor(width * 0.88);
  const threshold = Math.floor((right - left) / 2 * 0.30);
  const rows = [];
  for (let y = Math.floor(height * 0.12); y < Math.floor(height * 0.91); y++) {
    let dark = 0;
    for (let x = left; x < right; x += 2) if (pixels[y * width + x] < 125) dark++;
    if (dark >= threshold) rows.push(y);
  }
  const peaks = [];
  for (const row of rows) if (!peaks.length || row - peaks.at(-1).end > 2) peaks.push({ start: row, end: row }); else peaks.at(-1).end = row;
  return { peaks: peaks.length, rows: rows.length };
}

const dir = process.argv[2];
for (let i = 1; i <= 17; i++) {
  const f = `${dir}/preview-${String(i).padStart(2, '0')}.pgm`;
  try {
    const r = hasStavesVerbose(fs.readFileSync(f));
    console.log(`page ${String(i).padStart(2)}: peaks=${r.peaks} rows=${r.rows} => ${r.peaks >= 10 ? 'PASS' : 'fail'}`);
  } catch (e) { console.log(`page ${i}: ERR ${e.message}`); }
}
