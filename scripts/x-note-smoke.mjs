import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5173/');
  const result = await page.evaluate(async () => {
    const { parseScore } = await import('/src/score.js');
    const { ChoirPlayer } = await import('/src/audio.js');
    const xml = `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Soprano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><type>eighth</type><notehead>x</notehead><lyric><text>shaa</text></lyric></note><note><unpitched><display-step>A</display-step><display-octave>4</display-octave></unpitched><duration>1</duration><type>eighth</type><notehead>x</notehead></note><note><pitch><step>B</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type></note></measure></part></score-partwise>`;
    const score = parseScore(xml);
    const player = new ChoirPlayer(() => {}, () => {});
    player.setScore(score);
    const track = score.tracks[0];
    const performed = player.performanceNotes(track);
    const events = player.buildEvents();
    const sent = [];
    for (const event of events.filter(event => event.startsNote)) {
      event.send({ noteOn: (_, midi, velocity) => sent.push({ midi, velocity }) }, event.seconds + 0.05);
    }
    player.mode = 'piano';
    const pianoNotes = [];
    for (const event of player.buildEvents().filter(event => event.startsNote)) {
      event.send({ noteOn: (_, midi, velocity) => pianoNotes.push({ midi, velocity }) }, event.seconds + 0.05);
    }
    return { crossNoteheads: score.breathNotes, midi: track.notes.map(n => n.midi), ornaments: performed.map(n => n.ornament), noteOnEvents: events.filter(e => e.startsNote).length, sent, pianoNotes };
  });
  assert.equal(result.crossNoteheads, 2);
  assert.deepEqual(result.midi, [67, 69, 71]);
  assert.deepEqual(result.ornaments, ['breath', 'breath', '']);
  assert.equal(result.noteOnEvents, 3);
  assert.deepEqual(result.sent.map(note => note.midi), [67, 69, 71]);
  assert.deepEqual(result.sent.map(note => note.velocity), [82, 82, 82]);
  assert.deepEqual(result.pianoNotes, result.sent);
  console.log(result);
} finally { await browser.close(); }
