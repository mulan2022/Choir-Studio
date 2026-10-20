import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

function command(binary, args, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true });
    let output = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${binary} 超时。`)); }, timeout);
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output = (output + chunk.toString()).slice(-20000); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(output) : reject(new Error(`${binary} 失败：${output.slice(-500)}`)); });
  });
}

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

function hasStaves(bytes) {
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
  return peaks.length >= 10;
}

export async function inspectPdf(input, temp, onProgress = () => {}) {
  const info = await command('pdfinfo', [input]);
  const pages = Number(info.match(/^Pages:\s*(\d+)/m)?.[1]);
  if (!pages) throw new Error('无法读取 PDF 页数。');
  const scanPages = pages;
  const prefix = path.join(temp, 'preview');
  onProgress({ stage: `扫描 ${scanPages} 页，查找五线谱页`, totalPages: pages });
  await command('pdftoppm', ['-f', '1', '-l', String(scanPages), '-scale-to', '1200', '-gray', input, prefix], Math.max(90000, pages * 5000));
  const files = (await fs.readdir(temp)).filter(name => /^preview-\d+\.pgm$/.test(name)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  const scorePages = [];
  for (const [index, file] of files.entries()) {
    onProgress({ stage: `检查第 ${index + 1} / ${scanPages} 页`, totalPages: pages });
    if (hasStaves(await fs.readFile(path.join(temp, file)))) scorePages.push(index + 1);
  }
  if (!scorePages.length) return { pages, firstPage: 1, lastPage: pages, detected: false };
  const runs = [];
  for (const page of scorePages) {
    if (runs.length && page === runs.at(-1).lastPage + 1) runs.at(-1).lastPage = page;
    else runs.push({ firstPage: page, lastPage: page });
  }
  const longest = runs.sort((a, b) => (b.lastPage - b.firstPage) - (a.lastPage - a.firstPage))[0];
  return { pages, ...longest, detected: true };
}
