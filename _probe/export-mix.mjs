// 导出「钢琴 100% + 女高 100% + 其他声部 20%」混音 WAV
// 用法: node _probe/export-mix.mjs <谱子文件> [输出目录]
// 环境变量:
//   FEATURE_INDEX  女高声部序号（必填，从 0 数）
//   LEAD_VOL       女高音量 0..1（默认 1.0）
//   OTHER_VOL      其他声部音量 0..1（默认 0.2）
//   PIANO_VOL      钢琴音量 0..1（默认 1.0）
//   MODE           voice|piano（默认 voice，人声 doo + 钢琴真钢琴）
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';

const input = path.resolve(process.argv[2]);
const outdir = path.resolve(process.argv[3] || 'exports');
const base = process.env.CHOIR_BASE_URL || 'http://127.0.0.1:4173/';
const FEATURE = parseInt(process.env.FEATURE_INDEX ?? '', 10);
if (!Number.isFinite(FEATURE)) throw new Error('必须设置 FEATURE_INDEX（女高声部序号）');
const LEAD = Number(process.env.LEAD_VOL ?? 1.0);
const OTHER = Number(process.env.OTHER_VOL ?? 0.2);
const PIANO = Number(process.env.PIANO_VOL ?? 1.0);
const MODE = process.env.MODE || 'voice';

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
  }, null, { timeout: 30 * 60 * 1000 });
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
  console.log('TRACKS ' + JSON.stringify(tracks));
  if (FEATURE >= tracks.length) throw new Error(`FEATURE_INDEX=${FEATURE} 超出声部数 ${tracks.length}`);
  const info = await page.evaluate(() => document.querySelector('#score-meta')?.textContent || '');
  console.log('META ' + info);

  // 切音色模式（默认就是人声版，显式再点一次保险）
  if (MODE === 'piano') {
    await page.locator('[data-mode="piano"]').click();
  }

  // 全部开启 + 设置每个声部音量
  await page.locator('#all-tracks').click();
  await page.evaluate(([feature, lead, other, piano]) => {
    document.querySelectorAll('#tracks .track').forEach((t, i) => {
      const letter = t.querySelector('.track-letter')?.textContent || '';
      const slider = t.querySelector('input.volume');
      const vol = i === feature ? lead : (letter === 'P' ? piano : other);
      slider.value = String(Math.round(vol * 100));
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }, [FEATURE, LEAD, OTHER, PIANO]);

  const downloadPromise = page.waitForEvent('download', { timeout: 20 * 60 * 1000 });
  await page.locator('#export-audio').click();
  const download = await downloadPromise;
  await fs.mkdir(outdir, { recursive: true });
  const targetPath = path.join(outdir, download.suggestedFilename());
  await download.saveAs(targetPath);
  const stat = await fs.stat(targetPath);
  console.log(JSON.stringify({ ok: true, file: targetPath, bytes: stat.size, pageErrors: errors }));
} finally { await browser.close(); }
