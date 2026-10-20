import fs from 'node:fs/promises';
import { chromium } from 'playwright-core';
import JSZip from 'jszip';

const browser = await chromium.launch({ executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1800, height: 1100 }, deviceScaleFactor: 2 });
await page.goto('http://127.0.0.1:5187/');
await page.locator('#sample-button').click();
await page.locator('#score-view svg').waitFor();
await page.waitForTimeout(500);
const png = await page.locator('#score-view').screenshot({ path: 'omr-fixture.png' });
const pdfPage = await browser.newPage({ viewport: { width: 1800, height: 1100 } });
await pdfPage.setContent(`<html><body style="margin:0"><img style="width:100%" src="data:image/png;base64,${png.toString('base64')}"></body></html>`);
const pdf = await pdfPage.pdf({ path: 'omr-fixture.pdf', width: '1800px', height: '1100px', printBackground: true });
const response = await fetch('http://127.0.0.1:5187/api/recognize?ext=png', { method: 'POST', body: png });
const data = Buffer.from(await response.arrayBuffer());
const extension = response.headers.get('X-Score-Extension');
let info = `bytes=${data.length}`;
if (response.ok && extension === 'mxl') {
  const zip = await JSZip.loadAsync(data);
  info = Object.keys(zip.files).join(', ');
} else if (!response.ok) info = data.toString('utf8').slice(-1000);
await fs.writeFile('omr-response.bin', data);
const pdfResponse = await fetch('http://127.0.0.1:5187/api/recognize?ext=pdf', { method: 'POST', body: pdf });
const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer());
const pdfBytes = pdfBuffer.length;
let pdfNotes = 0;
if (pdfResponse.ok) {
  const pdfZip = await JSZip.loadAsync(pdfBuffer);
  const pdfXml = await pdfZip.file('score.xml')?.async('text') || '';
  pdfNotes = (pdfXml.match(/<note(?:\s|>)/g) || []).length;
}
await page.locator('#file-input').setInputFiles({ name: 'test-scan.png', mimeType: 'image/png', buffer: png });
await page.waitForFunction(() => !document.getElementById('status').textContent.includes('识谱'), null, { timeout: 90000 });
const uploadedTracks = await page.locator('.track').count();
const uploadStatus = await page.locator('#status').textContent();
await browser.close();
console.log(JSON.stringify({ status: response.status, extension, info, pdfStatus: pdfResponse.status, pdfBytes, pdfNotes, uploadedTracks, uploadStatus }));
if (!response.ok || !pdfResponse.ok || pdfNotes === 0 || uploadedTracks !== 4 || !uploadStatus.includes('就绪')) process.exitCode = 1;
