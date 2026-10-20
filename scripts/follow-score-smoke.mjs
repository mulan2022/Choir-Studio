import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });

await page.goto('http://127.0.0.1:5187/', { waitUntil: 'networkidle' });
await page.locator('#file-input').setInputFiles('D:\\demo\\ChoirSinger\\exports\\蒲公英-homr混合版.musicxml');
await page.locator('#score-view svg').first().waitFor({ timeout: 30000 });
await page.waitForTimeout(800);

const before = await page.evaluate(() => {
  const paper = document.querySelector('#score-paper');
  const cursors = document.querySelectorAll('#score-view img[id^="cursorImg"]');
  const cursor = cursors[cursors.length - 1];
  return {
    pages: document.querySelectorAll('#score-view svg').length,
    cursorCount: cursors.length,
    cursorDisplay: cursor ? getComputedStyle(cursor).display : 'missing',
    cursorLeft: cursor?.style.left,
    cursorTop: cursor?.style.top,
    scrollTop: paper.scrollTop,
    scrollHeight: paper.scrollHeight,
    clientHeight: paper.clientHeight,
  };
});

await page.locator('#seek').fill('850');
await page.locator('#seek').dispatchEvent('input');
await page.waitForTimeout(900);

const after = await page.evaluate(() => {
  const paper = document.querySelector('#score-paper');
  const cursors = document.querySelectorAll('#score-view img[id^="cursorImg"]');
  const cursor = cursors[cursors.length - 1];
  const cursorRect = cursor?.getBoundingClientRect();
  const paperRect = paper.getBoundingClientRect();
  return {
    pageLabel: document.querySelector('#score-page-status')?.textContent,
    cursorLeft: cursor?.style.left,
    cursorTop: cursor?.style.top,
    cursorRect: cursorRect ? { x: cursorRect.x, y: cursorRect.y, width: cursorRect.width, height: cursorRect.height } : null,
    paperRect: { x: paperRect.x, y: paperRect.y, width: paperRect.width, height: paperRect.height },
    cursorZ: cursor ? getComputedStyle(cursor).zIndex : null,
    cursorOpacity: cursor ? getComputedStyle(cursor).opacity : null,
    scrollTop: paper.scrollTop,
  };
});

await page.screenshot({ path: 'follow-score-smoke.png', fullPage: false });
console.log(JSON.stringify({ before, after, errors }, null, 2));
await browser.close();

const cursorMoved = before.cursorLeft !== after.cursorLeft || before.cursorTop !== after.cursorTop;
if (errors.length || before.pages < 2 || before.cursorDisplay === 'missing' || before.scrollHeight <= before.clientHeight || !cursorMoved || after.scrollTop <= 0 || !/第 \d+ \/ \d+ 页/.test(after.pageLabel || '')) process.exitCode = 1;
