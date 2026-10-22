import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const xml = '<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Soprano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>1</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note></measure></part></score-partwise>';
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('http://127.0.0.1:5187/', { waitUntil: 'domcontentloaded' });
  assert.equal(await page.locator('#export-format').inputValue(), 'mp3');
  await page.locator('#file-input').setInputFiles({ name: 'tiny.musicxml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
  await page.locator('#loaded').waitFor({ state: 'visible' });
  const downloadPromise = page.waitForEvent('download', { timeout: 120000 });
  await page.locator('#export-audio').click();
  const download = await downloadPromise.catch(async error => {
    throw new Error(`${error.message}\nstatus=${await page.locator('#status').textContent()}\ntoast=${await page.locator('.toast').allTextContents()}\nerrors=${JSON.stringify(errors)}`);
  });
  assert.match(download.suggestedFilename(), /\.mp3$/);
  assert.ok((await stat(await download.path())).size > 1000);

  const result = await page.evaluate(async xml => {
    const { ChoirPlayer } = await import('/src/audio.js');
    const { parseScore } = await import('/src/score.js');
    const score = parseScore(xml);
    const player = new ChoirPlayer(() => {}, () => {});
    player.setScore(score);
    const mp3 = await player.exportAudio({ format: 'mp3' });
    const wav = await player.exportAudio({ format: 'wav' });
    const mp3Buffer = await mp3.blob.arrayBuffer();
    const decoded = await new AudioContext().decodeAudioData(mp3Buffer.slice(0));
    const samples = decoded.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
    const longerXml = xml.replace('<beats>1</beats>', '<beats>20</beats>').replace('<duration>1</duration>', '<duration>20</duration>');
    const longer = new ChoirPlayer(() => {}, () => {});
    longer.setScore(parseScore(longerXml));
    const start = performance.now();
    const rendered = await longer.exportAudio({ format: 'wav' });
    const renderMs = performance.now() - start;
    const cancelPlayer = new ChoirPlayer(() => {}, () => {});
    cancelPlayer.setScore(parseScore(longerXml));
    const interrupted = cancelPlayer.exportAudio({ format: 'wav', onProgress: fraction => {
      if (fraction > 0) cancelPlayer.cancelExport();
    } }).then(() => false, error => /取消/.test(error.message));
    player.exporting = true;
    const large = { left: new Float32Array(48000 * 60), right: new Float32Array(48000 * 60), sampleRate: 48000 };
    const cancelled = player.encodeMp3(large).then(() => false, error => /取消/.test(error.message));
    player.cancelExport();
    const another = { left: new Float32Array(48000), right: new Float32Array(48000), sampleRate: 48000 };
    const paused = player.encodeMp3(another).then(() => false, error => /取消/.test(error.message));
    player.pause();
    return {
      mp3Size: mp3.blob.size,
      wavSize: wav.blob.size,
      mp3Type: mp3.blob.type,
      wavType: wav.blob.type,
      decodedSeconds: decoded.duration,
      peak,
      renderMs,
      renderedSeconds: rendered.seconds,
      renderCancelled: await interrupted,
      cancelled: await cancelled,
      pausedCancelled: await paused,
      mp3Header: Array.from(new Uint8Array(mp3Buffer.slice(0, 4))),
    };
  }, xml);
  assert.deepEqual(errors, []);
  assert.equal(result.mp3Type, 'audio/mpeg');
  assert.equal(result.wavType, 'audio/wav');
  assert.ok(result.mp3Size < result.wavSize / 5, JSON.stringify(result));
  assert.ok(result.decodedSeconds > 1 && result.decodedSeconds < 5, JSON.stringify(result));
  assert.ok(result.peak > 0.01, JSON.stringify(result));
  assert.ok(result.renderMs < result.renderedSeconds * 1000, JSON.stringify(result));
  assert.equal(result.renderCancelled, true);
  assert.equal(result.cancelled, true);
  assert.equal(result.pausedCancelled, true);
  console.log(result);
} finally {
  await browser.close();
}
