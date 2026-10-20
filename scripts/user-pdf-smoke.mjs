import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';

const file = (await fs.readdir('.')).find(name => name.toLowerCase().endsWith('.pdf'));
if (!file) throw new Error('No PDF found in project root');
const browser = await chromium.launch({ executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
await page.goto('http://127.0.0.1:5187/');
await page.locator('#file-input').setInputFiles(path.resolve(file));
await page.locator('#import-progress').waitFor({ state: 'visible' });
const started = Date.now();
const timer = setInterval(async () => {
  try { console.log(JSON.stringify({ elapsed: Math.round((Date.now() - started) / 1000), progress: await page.locator('#import-stage').textContent(), detail: await page.locator('#import-detail').textContent() })); }
  catch { /* browser may be closing */ }
}, 20000);
try {
  await page.waitForFunction(() => document.querySelectorAll('.track').length > 0 || document.getElementById('import-progress').classList.contains('failed'), null, { timeout: 900000 });
  const result = await page.evaluate(() => ({ title: document.getElementById('score-title').textContent, tracks: document.querySelectorAll('.track').length, svg: document.querySelectorAll('#score-view svg').length, measures: document.getElementById('score-meta').textContent, error: document.getElementById('import-detail').textContent }));
  await page.screenshot({ path: 'user-pdf-preview.png' });
  console.log(JSON.stringify({ result, errors }, null, 2));
  if (!result.tracks || !result.svg || errors.length) process.exitCode = 1;
} finally { clearInterval(timer); await browser.close(); }
