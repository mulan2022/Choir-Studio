import path from 'node:path';
import fs from 'node:fs/promises';
import { chromium } from 'playwright-core';

const name = process.argv[2];
if (!name) throw new Error('Usage: node scripts/repro-upload.mjs <score.pdf>');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('http://127.0.0.1:5173/');
  if (process.argv.includes('--switch')) {
    await page.locator('#sample-button').click();
    await page.waitForFunction(() => document.querySelectorAll('#score-view svg').length > 0);
    if (process.argv.includes('--playing')) {
      await page.locator('#play-button').click();
      await page.waitForFunction(() => document.querySelector('#time-now').textContent !== '0:00', null, { timeout: 30000 });
    }
  }
  if (process.argv.includes('--fresh')) {
    const bytes = await fs.readFile(path.resolve(name));
    await page.locator('#file-input').setInputFiles({ name, mimeType: 'application/pdf', buffer: Buffer.concat([bytes, Buffer.from('\n% fresh recognition repro\n')]) });
  } else await page.locator('#file-input').setInputFiles(path.resolve(name));
  const log = setInterval(async () => {
    const progress = await page.evaluate(() => ({ stage: document.querySelector('#import-stage').textContent, detail: document.querySelector('#import-detail').textContent }));
    console.log(JSON.stringify(progress));
  }, 30000);
  try {
    await page.waitForFunction(() => document.querySelector('#import-progress').hidden || document.querySelector('#import-progress').classList.contains('failed'), null, { timeout: 1200000 });
  } finally { clearInterval(log); }
  console.log(JSON.stringify(await page.evaluate(() => ({
    failed: document.querySelector('#import-progress').classList.contains('failed'),
    stage: document.querySelector('#import-stage').textContent,
    detail: document.querySelector('#import-detail').textContent,
    title: document.querySelector('#score-title').textContent,
    meta: document.querySelector('#score-meta').textContent,
    tracks: document.querySelectorAll('.track').length,
    pages: document.querySelectorAll('#score-view svg').length,
  }))));
  if (process.argv.includes('--exercise')) {
    await page.locator('#play-button').click();
    await page.waitForFunction(() => document.querySelector('#time-now').textContent !== '0:00', null, { timeout: 30000 });
    for (const value of [250, 500, 750, 990, 100]) {
      await page.locator('#seek').fill(String(value));
      await page.waitForTimeout(250);
    }
    console.log(JSON.stringify(await page.evaluate(() => ({ playback: document.querySelector('#time-now').textContent, status: document.querySelector('#status').textContent }))));
  }
  if (process.argv.includes('--zoom-pause')) {
    if (await page.locator('#play-button').getAttribute('aria-label') === '播放') await page.locator('#play-button').click();
    const before = await page.locator('#score-view svg').count();
    await page.evaluate(() => { document.body.style.zoom = '125%'; });
    await page.waitForTimeout(300);
    await page.evaluate(() => { document.body.style.zoom = '100%'; });
    await page.locator('#play-button').click();
    const after = await page.locator('#score-view svg').count();
    const state = await page.evaluate(() => ({ status: document.querySelector('#status').textContent, control: document.querySelector('#play-button').getAttribute('aria-label') }));
    console.log(JSON.stringify({ zoomPause: { pagesBefore: before, pagesAfter: after, ...state } }));
    if (before !== after || state.control !== '播放' || state.status !== '已暂停') throw new Error('缩放或暂停后播放器状态不正确。');
  }
  console.log(JSON.stringify({ errors }));
  if (errors.length) throw new Error(`浏览器报错：${errors.join(' | ')}`);
} finally { await browser.close(); }
