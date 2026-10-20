import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  const result = await page.evaluate(async () => {
    const { ChoirPlayer } = await import('/src/audio.js');
    const { parseScore } = await import('/src/score.js');
    const xml = '<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Soprano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note></measure></part></score-partwise>';
    const score = parseScore(xml);
    const player = new ChoirPlayer(() => {}, () => {});
    player.setScore(score);
    let finishInitialization;
    player.initialize = () => new Promise(resolve => { finishInitialization = resolve; });
    const firstStart = player.play();
    const wasStarting = player.starting;
    player.pause();
    finishInitialization();
    await firstStart;
    const canceledStart = !player.playing && !player.starting && !player.timer;

    const calls = [];
    const gain = {
      cancelScheduledValues: time => calls.push(['cancel', time]),
      setValueAtTime: (value, time) => calls.push(['set', value, time]),
      linearRampToValueAtTime: (value, time) => calls.push(['ramp', value, time]),
    };
    player.initialize = async () => {};
    player.context = { currentTime: 1, resume: async () => {} };
    player.masterGain = { gain };
    player.synth = {
      stopAll: () => calls.push(['stopAll']),
      programChange() {}, pitchWheelRange() {}, controllerChange() {},
      noteOn: (_, midi, __, options) => calls.push(['noteOn', midi, options.time]),
      noteOff: (_, midi, options) => calls.push(['noteOff', midi, options.time]),
    };
    await player.play();
    const wasPlaying = player.playing;
    player.context.currentTime = 1.08;
    player.pause();
    const mutedOnPause = calls.some(call => call[0] === 'set' && call[1] === 0 && call[2] === 1.08);
    const stoppedOnPause = calls.at(-1)?.[0] === 'stopAll';
    return { wasStarting, canceledStart, wasPlaying, mutedOnPause, stoppedOnPause, timerCleared: !player.timer };
  });
  assert.deepEqual(result, { wasStarting: true, canceledStart: true, wasPlaying: true, mutedOnPause: true, stoppedOnPause: true, timerCleared: true });
  console.log(result);
} finally {
  await browser.close();
}
