import { chromium } from 'playwright-core';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5173/');
  const started = Date.now();
  await page.locator('#file-input').setInputFiles('diagnostic-xnotes/full-recovered.mxl');
  await page.waitForFunction(() => document.querySelector('#import-progress')?.hidden && document.querySelector('#score-meta')?.textContent?.includes('178 小节') && !!document.querySelector('#score-view svg .vf-notehead'), { timeout: 120000 });
  const loadMs = Date.now() - started;
  await page.locator('#edit-tab').click();
  const heads = page.locator('#score-view svg .vf-stavenote .vf-notehead');
  let selected = '';
  for (let i = 0; i < Math.min(40, await heads.count()); i++) {
    await heads.nth(i).click({ force: true });
    selected = await page.locator('#editor-selection').textContent();
    if (selected.includes('·')) break;
  }
  if (!selected.includes('·')) throw new Error(`Full score note selection failed: ${selected}`);
  await page.locator('#pitch-sharp').click();
  await page.waitForFunction(() => document.querySelector('#pitch-target')?.textContent !== '—', { timeout: 10000 });
  const pendingName = await page.locator('#pitch-target').textContent();
  const changedAt = Date.now();
  await page.locator('#apply-pitch').click();
  await page.waitForFunction(() => document.querySelector('#editor-message')?.textContent?.includes('已更新'), { timeout: 120000 });
  const changeMs = Date.now() - changedAt;
  if (errors.length) throw new Error(errors.join('; '));
  console.log(JSON.stringify({ loadMs, changeMs, selected, pendingName, updated: await page.locator('#editor-selection').textContent(), measureInfo: await page.locator('#score-meta').textContent(), errors }, null, 2));
} finally { await browser.close(); }
