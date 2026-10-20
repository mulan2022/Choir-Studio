import { chromium } from 'playwright-core';
import JSZip from 'jszip';
import { sampleXML } from '../src/sample.js';

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(`${message.text()} @ ${message.location().url}`); });
page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
await page.goto('http://127.0.0.1:5187/', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /先听四声部示例/ }).click();
await page.locator('.track').first().waitFor();
await page.waitForTimeout(1200);
const title = await page.locator('#score-title').textContent();
const tracks = await page.locator('.track').count();
const svgCount = await page.locator('#score-view svg').count();
const measureNumberCount = await page.locator('#score-view .measure-number').count();
const timelineLanes = await page.locator('.timeline-lane').count();
const sopranoTrillNotes = await page.locator('.timeline-lane').first().locator('.timeline-note.trill').count();
await page.screenshot({ path: 'smoke-desktop.png', fullPage: true });
await page.locator('#play-button').click();
await page.waitForTimeout(3500);
const status = await page.locator('#status').textContent();
const current = await page.locator('#time-now').textContent();
await page.locator('.timeline-lane').first().locator('.timeline-note.trill').first().click();
await page.waitForTimeout(150);
const seeked = await page.locator('#time-now').textContent();
await page.locator('[data-mode="piano"]').click();
await page.locator('.track .solo').nth(1).click();
const soloCount = await page.locator('.track:not(.muted)').count();
await page.locator('#tempo').fill('120');
await page.locator('#tempo').dispatchEvent('change');
const tempo = await page.locator('#tempo-value').textContent();
await page.locator('#play-button').click();
const zip = new JSZip();
zip.file('META-INF/container.xml', '<container><rootfiles><rootfile full-path="score.musicxml"/></rootfiles></container>');
zip.file('score.musicxml', sampleXML);
const mxl = await zip.generateAsync({ type: 'nodebuffer' });
await page.locator('#file-input').setInputFiles({ name: 'sample.mxl', mimeType: 'application/vnd.recordare.musicxml', buffer: mxl });
await page.waitForTimeout(500);
const uploadedTitle = await page.locator('#score-title').textContent();
const closedRoles = await page.evaluate(async () => {
  const { parseScore } = await import('/src/score.js');
  const voice = (pitch, voice) => `<note><pitch><step>${pitch}</step><octave>4</octave></pitch><duration>4</duration><voice>${voice}</voice><type>quarter</type></note>`;
  const part = id => `<part id="${id}"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${voice('C', 1)}<backup><duration>1</duration></backup>${voice('E', 2)}</measure></part>`;
  const xml = `<score-partwise><part-list><score-part id="P1"><part-name>Women</part-name></score-part><score-part id="P2"><part-name>Men</part-name></score-part></part-list>${part('P1')}${part('P2')}</score-partwise>`;
  return parseScore(xml).tracks.map(track => track.role).join('');
});
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({ path: 'smoke-mobile.png', fullPage: true });
console.log(JSON.stringify({ title, tracks, svgCount, measureNumberCount, timelineLanes, sopranoTrillNotes, status, current, seeked, soloCount, tempo, uploadedTitle, closedRoles, errors }, null, 2));
await browser.close();
if (tracks !== 4 || svgCount === 0 || measureNumberCount !== 0 || timelineLanes !== 4 || sopranoTrillNotes !== 4 || errors.length || current === '0:00' || Number(seeked.slice(2)) < 4 || soloCount !== 1 || tempo !== '120%' || uploadedTitle !== title || closedRoles !== 'SATB') process.exitCode = 1;
