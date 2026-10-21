// 一键导出女高音 WAV：上传谱 → 等识谱 → 独奏女高 → 导出音频
// 用法: node _probe/export-soprano.mjs <谱子文件> [输出目录]
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';

const input = path.resolve(process.argv[2]);
const outdir = path.resolve(process.argv[3] || 'exports');
const base = process.env.CHOIR_BASE_URL || 'http://127.0.0.1:4173/';
const WANT = process.env.WANT_ROLE || 'S'; // 女高

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 120000 });

  await page.locator('#file-input').setInputFiles(input);
  await page.waitForFunction(() => {
    const p = document.querySelector('#import-progress');
    return p && (p.hidden || p.classList.contains('failed'));
  }, null, { timeout: 20 * 60 * 1000 });
  const failed = await page.evaluate(() => document.querySelector('#import-progress').classList.contains('failed'));
  if (failed) {
    const detail = await page.evaluate(() => document.querySelector('#import-detail')?.textContent || '');
    throw new Error('识谱/导入失败: ' + detail);
  }

  const tracks = await page.evaluate(() => [...document.querySelectorAll('#tracks .track')].map((t, i) => ({
    i,
    letter: t.querySelector('.track-letter')?.textContent || '',
    label: t.querySelector('strong')?.textContent || '',
    title: t.querySelector('small')?.textContent || '',
  })));
  console.log('TRACKS ' + JSON.stringify(tracks, null, 1));
  const idxOverride = parseInt(process.env.TRACK_INDEX ?? '', 10);
  const target = Number.isFinite(idxOverride) ? idxOverride : tracks.findIndex(t => t.letter === WANT);
  if (target < 0 || target >= tracks.length) throw new Error(`找不到角色 ${WANT} 的声部`);
  const info = await page.evaluate(() => document.querySelector('#score-meta')?.textContent || '');
  console.log('META ' + info);

  await page.locator(`#tracks .track[data-index="${target}"] .solo`).click();

  const downloadPromise = page.waitForEvent('download', { timeout: 15 * 60 * 1000 });
  await page.locator('#export-audio').click();
  const download = await downloadPromise;
  await fs.mkdir(outdir, { recursive: true });
  const targetPath = path.join(outdir, download.suggestedFilename());
  await download.saveAs(targetPath);
  const stat = await fs.stat(targetPath);
  console.log(JSON.stringify({ ok: true, file: targetPath, bytes: stat.size, pageErrors: errors }));
} finally { await browser.close(); }
