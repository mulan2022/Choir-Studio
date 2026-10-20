import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';

const file = (await fs.readdir('.')).find(name => name.toLowerCase().endsWith('.pdf'));
if (!file) throw new Error('项目目录里找不到测试 PDF。');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.CHOIR_BASE_URL || 'http://127.0.0.1:5187/');
  const started = Date.now();
  await page.locator('#file-input').setInputFiles(path.resolve(file));
  await page.waitForFunction(() => document.querySelector('#import-progress').hidden || document.querySelector('#import-progress').classList.contains('failed'), null, { timeout: 60000 });
  const result = await page.evaluate(() => ({
    title: document.querySelector('#score-title').textContent,
    measures: document.querySelector('#score-meta').textContent,
    tracks: document.querySelectorAll('.track').length,
    pages: document.querySelectorAll('#score-view svg').length,
    failed: document.querySelector('#import-progress').classList.contains('failed'),
  }));
  console.log(JSON.stringify({ ...result, elapsedSeconds: (Date.now() - started) / 1000, errors }));
  assert.equal(result.failed, false);
  assert.match(result.measures, /124 小节/);
  assert.equal(result.tracks, 6);
  assert.ok(result.pages > 0);
  await page.locator('#play-button').click();
  await page.waitForFunction(() => document.querySelector('#time-now').textContent !== '0:00', null, { timeout: 30000 });
  const playback = await page.evaluate(() => ({ time: document.querySelector('#time-now').textContent, activeBlocks: document.querySelectorAll('.timeline-note.active').length, playing: document.querySelector('#play-button').getAttribute('aria-label') }));
  console.log(JSON.stringify({ playback }));
  assert.equal(playback.playing, '暂停');
  assert.ok(playback.activeBlocks > 0);
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
