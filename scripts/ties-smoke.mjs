import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5187/');
  const actualXML = await readFile(new URL('../exports/蒲公英-校正拍号与延音.musicxml', import.meta.url), 'utf8');
  const result = await page.evaluate(async actualXML => {
    const { ChoirPlayer } = await import('/src/audio.js');
    const { parseScore } = await import('/src/score.js');
    const check = (value, message) => { if (!value) throw new Error(message); };
    const note = (ties = '', voice = 1, step = 'C', extra = '') => `<note>${extra}<pitch><step>${step}</step><octave>4</octave></pitch><duration>4</duration>${ties}<voice>${voice}</voice><type>whole</type></note>`;
    const tie = type => `<tie type="${type}"/>`;
    const measure = (body, i) => `<measure number="${i + 1}"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${body}</measure>`;
    const xml = bars => `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Soprano</part-name></score-part></part-list><part id="P1">${bars.map(measure).join('')}</part></score-partwise>`;
    const player = new ChoirPlayer(() => {}, () => {});
    const load = bars => { player.setScore(parseScore(xml(bars))); return player.performanceNotes(player.score.tracks[0]); };
    let performed = load([note(tie('start')), note(tie('stop') + tie('start')), note(tie('stop'))]);
    check(performed.length === 1 && performed[0].end === 12, 'Three bars must sustain as one note');
    const sent = [];
    for (const event of player.buildEvents()) event.send({ noteOn: (...args) => sent.push(['on', ...args]), noteOff: (...args) => sent.push(['off', ...args]) }, event.seconds);
    check(sent.length === 2 && sent[0][4].time === 0 && sent[1][3].time === 8, 'No note-off or reattack at intermediate barlines');

    // Start inside the tied continuation, then advance the audio clock to its end.
    const scheduled = [];
    player.initialize = async () => {};
    player.context = { currentTime: 0, resume: async () => {} };
    player.synth = {
      stopAll() {}, programChange() {}, pitchWheelRange() {}, controllerChange() {},
      noteOn: (...args) => scheduled.push(['on', ...args]),
      noteOff: (...args) => scheduled.push(['off', ...args]),
    };
    await player.play(5);
    clearInterval(player.timer);
    check(scheduled.length === 1 && scheduled[0][0] === 'on', 'Seek inside tie must sound immediately');
    player.context.currentTime = 4.7;
    player.tick();
    check(scheduled.length === 2 && scheduled[1][0] === 'off', 'Seek must retain final release');
    player.pause();
    player.setTempo(0.5);
    check(player.buildEvents().at(-1).seconds === 16, 'Tempo scales the entire sustain');
    player.setTempo(1);

    performed = load([note('<notations><tied type="start"/></notations>'), note('<notations><tied type="continue"/></notations>'), note('<notations><tied type="stop"/></notations>')]);
    check(performed.length === 1 && performed[0].end === 12, 'Visual-only ties and continue must work');
    performed = load([note(tie('start')) + note(tie('start'), 1, 'E', '<chord/>'), note(tie('stop')) + note(tie('stop'), 1, 'E', '<chord/>')]);
    check(performed.length === 2 && performed.every(n => n.end === 8), 'Interleaved chord tones sustain independently');
    performed = load([note(tie('start'), 1), note(tie('stop'), 2)]);
    check(performed.length === 2, 'Never merge different voices');
    performed = load([note(tie('start')), note(tie('stop'), 1, 'D')]);
    check(performed.length === 2, 'Never merge different pitches');
    performed = load([note(tie('start')), '<note><rest/><duration>4</duration></note>', note(tie('stop'))]);
    check(performed.length === 2, 'Never bridge rests');
    performed = load([note(tie('start')), note()]);
    check(performed.length === 2, 'A start alone cannot swallow a repeated note');
    performed = load([note(tie('stop'))]);
    check(performed.length === 1, 'Unmatched tie stops must remain audible');
    performed = load([note('<notations><slur type="start"/></notations>'), note('<notations><slur type="stop"/></notations>')]);
    check(performed.length === 2, 'Slurs are not sustain ties');
    performed = load([note(), note('', 1, 'D')]);
    const legato = player.buildEvents();
    const transitions = [];
    for (const event of legato) event.send({ noteOn: (_, midi, __, options) => transitions.push(['on', midi, options.time]), noteOff: (_, midi, options) => transitions.push(['off', midi, options.time]) }, event.seconds);
    const nextOn = transitions.find(entry => entry[0] === 'on' && entry[1] === 62)?.[2];
    const priorOff = transitions.find(entry => entry[0] === 'off' && entry[1] === 60)?.[2];
    check(nextOn !== undefined && Math.abs(priorOff - nextOn - 0.06) < 0.001, 'Adjacent pitches must overlap briefly in voice mode');
    player.setMode('piano');
    const pianoEvents = player.buildEvents();
    const pianoOff = pianoEvents[1].seconds;
    const pianoOn = pianoEvents[2].seconds;
    check(Math.abs(pianoOff - pianoOn) < 0.001, 'Piano mode keeps exact score timing');
    player.setMode('voice');
    scheduled.length = 0;
    player.context.currentTime = 0;
    await player.play(0);
    clearInterval(player.timer);
    player.context.currentTime = nextOn - 0.5;
    player.tick();
    check(scheduled.some(entry => entry[0] === 'on' && entry[2] === 62 && entry[4].time > player.context.currentTime), 'Next bar note must be queued before the visual update');
    player.pause();
    player.expressivePlayback = true;
    performed = load([note(tie('start')), note(tie('stop'))]);
    check(performed.length === 1 && performed[0].end === 8, 'Expression mode uses the same tie chain');
    player.expressivePlayback = false;

    player.setScore(parseScore(actualXML));
    const merged = player.score.tracks.flatMap(track => player.performanceNotes(track)).filter(n => n.segments.length > 1);
    const crossBar = merged.filter(n => n.source.measure !== n.segments.at(-1).measure);
    check(crossBar.length >= 35, 'Repaired score must connect the verified cross-bar ties');
    return { checksPassed: 16, mergedChains: merged.length, crossBarChains: crossBar.length, examples: crossBar.slice(0, 4).map(n => ({ fromMeasure: n.source.measure + 1, toMeasure: n.segments.at(-1).measure + 1, beats: n.end - n.beat })) };
  }, actualXML);
  assert.ok(result.crossBarChains > 0);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
